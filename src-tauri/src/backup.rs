//! Manual full-vault backups. Layout (version 1):
//! backups_dir（默认 app_data_dir()/backups，可在设置中更改）/<id>/{manifest.json,learning.json,knowledge/…}
//! app_data_dir()/restored/<unique>/{manifest.json,learning.json,knowledge/…}
//! `RestoredBackup.path` is the NEW knowledge directory; current root is never changed.
//! All regular vault files (including assets and .kv history/trash) and directories
//! are retained; only .git is excluded. SHA-256 covers each file and learning.json.
//! Snapshots are compared before/after copying and the copied tree is rehashed.
//! Publication is a same-filesystem, no-clobber directory rename. Failed/crashed
//! operations leave hidden .staging-* directories, never listed or automatically
//! deleted (preserves recovery evidence; no recursive deletion of user data).
//! Limits: 20,000 files, 1 GiB vault, 100 MiB/file, 10 MiB learning. Additionally
//! directories <=20,000, depth <=64, relative UTF-8 path <=4096 bytes, manifest <=16 MiB.
//! Symlinks/reparse points and non-regular files are refused, including ancestors.
//! This detects ordinary external edits, not a filesystem snapshot or protection
//! against a hostile process swapping ancestor directories during system calls.
use crate::{safe_path, vault, AppState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

const MAX_FILES: usize = 20_000;
const MAX_DIRS: usize = 20_000;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_FILE: u64 = 100 * 1024 * 1024;
const MAX_LEARNING: u64 = 10 * 1024 * 1024;
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;

type Result<T> = std::result::Result<T, String>;
fn io(e: impl std::fmt::Display) -> String { e.to_string() }

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub created_ms: u64,
    pub source_root: String,
    /// Regular vault files only; learning/manifest are excluded from totals.
    pub files: u64,
    pub bytes: u64,
    /// Absolute backup folder, suitable for manual copying to another disk.
    pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestoredBackup {
    pub path: String,
    pub learning: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Entry { path: String, bytes: u64, sha256: String }

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
struct Tree { directories: Vec<String>, entries: Vec<Entry> }

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: u32,
    id: String,
    created_ms: u64,
    source_root: String,
    files: u64,
    bytes: u64,
    learning_bytes: u64,
    learning_sha256: String,
    tree: Tree,
}

fn id_valid(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !id.as_bytes()[0].is_ascii_alphanumeric() {
        return Err("备份 id 无效".into());
    }
    Ok(())
}

fn rel_valid(rel: &str) -> Result<()> {
    if rel.len() > 4096 || rel.split('/').count() > 64 || rel.contains('\\') {
        return Err("备份相对路径非法或过长".into());
    }
    for part in rel.split('/') {
        safe_path::component(part, true)?;
        if part.eq_ignore_ascii_case(".git") { return Err("清单不能包含 .git".into()); }
    }
    Ok(())
}

/// Check every existing ancestor before resolving it. Never canonicalize away a
/// symlink/junction first, and reject relative roots to avoid cwd-dependent IO.
fn checked_path(path: &Path, allow_missing: bool) -> Result<PathBuf> {
    if !path.is_absolute() { return Err("路径必须是绝对路径".into()); }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) => { out.push(component.as_os_str()); continue; }
            Component::CurDir => continue,
            Component::ParentDir => { out.pop(); continue; }
            _ => out.push(component.as_os_str()),
        }
        // A Windows drive prefix on its own is not an absolute filesystem entry.
        if !out.is_absolute() { continue; }
        match fs::symlink_metadata(&out) {
            Ok(m) => {
                if safe_path::is_link(&m) { return Err(format!("拒绝符号链接/目录联接: {}", out.display())); }
            }
            Err(e) if allow_missing && e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("检查路径 {}: {e}", out.display())),
        }
    }
    Ok(out)
}

fn directory(path: &Path, create: bool) -> Result<PathBuf> {
    let path = checked_path(path, create)?;
    if create { fs::create_dir_all(&path).map_err(io)?; }
    checked_path(&path, false)?;
    if !fs::symlink_metadata(&path).map_err(io)?.is_dir() { return Err("需要普通目录".into()); }
    path.canonicalize().map_err(io)
}

fn child(root: &Path, rel: &str, missing: bool) -> Result<PathBuf> {
    rel_valid(rel)?;
    checked_path(&root.join(rel), missing)
}

fn disjoint_target(source: &Path, target: &Path) -> Result<()> {
    let source = directory(source, false)?;
    // Inspect the existing ancestor, then append absent components for a reliable
    // canonical containment check WITHOUT creating anything inside the source.
    let target = checked_path(target, true)?;
    let mut ancestor = target.as_path();
    let mut suffix = Vec::new();
    while !ancestor.try_exists().map_err(io)? {
        suffix.push(ancestor.file_name().ok_or("备份目录无效")?.to_os_string());
        ancestor = ancestor.parent().ok_or("备份目录无效")?;
    }
    let mut resolved = ancestor.canonicalize().map_err(io)?;
    for part in suffix.iter().rev() { resolved.push(part); }
    if resolved.starts_with(&source) { return Err("备份/恢复目录不能位于源知识库内部".into()); }
    Ok(())
}

fn open_read(path: &Path) -> Result<File> {
    checked_path(path, false)?;
    let before = fs::symlink_metadata(path).map_err(io)?;
    if !before.is_file() || safe_path::is_link(&before) { return Err("拒绝非常规文件或链接".into()); }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        // OPEN_REPARSE_POINT: do not follow final reparse points. Read sharing only
        // denies write/delete while the file handle is being read.
        options.custom_flags(0x00200000).share_mode(1);
    }
    #[cfg(target_os = "linux")] {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(0x20000); // O_NOFOLLOW
    }
    let file = options.open(path).map_err(io)?;
    let m = file.metadata().map_err(io)?;
    if !m.is_file() || safe_path::is_link(&m) { return Err("拒绝非常规文件或链接".into()); }
    checked_path(path, false)?;
    Ok(file)
}

fn new_file(path: &Path) -> Result<File> {
    checked_path(path, true)?;
    OpenOptions::new().write(true).create_new(true).open(path).map_err(io)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = new_file(path)?;
    file.write_all(bytes).map_err(io)?;
    file.sync_all().map_err(io)
}

fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = open_read(path)?;
    if file.metadata().map_err(io)?.len() > limit { return Err("文件超出读取限额".into()); }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() as u64 > limit { return Err("文件超出读取限额".into()); }
    Ok(bytes)
}

fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

/// Hash exactly the bytes written, not a separate read followed by fs::copy.
fn hash_copy(src: &Path, dest: Option<&Path>, limit: u64) -> Result<(u64, String)> {
    let mut source = open_read(src)?;
    let before = source.metadata().map_err(io)?;
    if before.len() > limit { return Err("单文件或总字节数超出限额".into()); }
    let mut target = dest.map(new_file).transpose()?;
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = source.read(&mut buffer).map_err(io)?;
        if n == 0 { break; }
        bytes += n as u64;
        if bytes > limit { return Err("单文件或总字节数超出限额".into()); }
        hasher.update(&buffer[..n]);
        if let Some(target) = target.as_mut() { target.write_all(&buffer[..n]).map_err(io)?; }
    }
    if let Some(target) = target { target.sync_all().map_err(io)?; }
    let after = source.metadata().map_err(io)?;
    checked_path(src, false)?;
    if before.len() != bytes || after.len() != bytes || before.modified().map_err(io)? != after.modified().map_err(io)? {
        return Err("读取期间文件被修改，请重试".into());
    }
    Ok((bytes, format!("{:x}", hasher.finalize())))
}

fn scan(root: &Path, exclude_git: bool) -> Result<Tree> {
    directory(root, false)?;
    let mut tree = Tree::default();
    let mut bytes = 0u64;
    fn walk(root: &Path, rel: &str, exclude_git: bool, tree: &mut Tree, bytes: &mut u64) -> Result<()> {
        let dir = if rel.is_empty() { root.to_path_buf() } else { child(root, rel, false)? };
        for entry in fs::read_dir(&dir).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().into_string().map_err(|_| "路径必须是有效 UTF-8")?;
            let m = fs::symlink_metadata(entry.path()).map_err(io)?;
            if safe_path::is_link(&m) { return Err(format!("拒绝符号链接/目录联接: {name}")); }
            if exclude_git && name.eq_ignore_ascii_case(".git") { continue; }
            let next = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            let path = child(root, &next, false)?;
            if m.is_dir() {
                if tree.directories.len() >= MAX_DIRS { return Err("目录数超出限额".into()); }
                tree.directories.push(next.clone());
                walk(root, &next, exclude_git, tree, bytes)?;
            } else if m.is_file() {
                if tree.entries.len() >= MAX_FILES { return Err("文件数超出限额".into()); }
                let (size, digest) = hash_copy(&path, None, MAX_FILE.min(MAX_BYTES - *bytes))?;
                *bytes += size;
                tree.entries.push(Entry { path: next, bytes: size, sha256: digest });
            } else { return Err("拒绝非常规文件".into()); }
        }
        Ok(())
    }
    walk(root, "", exclude_git, &mut tree, &mut bytes)?;
    tree.directories.sort();
    tree.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(tree)
}

fn validate_tree(tree: &Tree) -> Result<u64> {
    if tree.entries.len() > MAX_FILES || tree.directories.len() > MAX_DIRS { return Err("清单条目数超限".into()); }
    let mut paths = HashSet::new();
    let dirs: HashSet<&str> = tree.directories.iter().map(String::as_str).collect();
    for path in tree.directories.iter().map(String::as_str).chain(tree.entries.iter().map(|e| e.path.as_str())) {
        rel_valid(path)?;
        // Portable case-insensitive duplicate rejection prevents Windows aliases.
        if !paths.insert(path.to_lowercase()) { return Err("清单有重复/冲突路径".into()); }
        if let Some((parent, _)) = path.rsplit_once('/') {
            if !dirs.contains(parent) { return Err("清单缺少父目录".into()); }
        }
    }
    let mut total = 0u64;
    for entry in &tree.entries {
        if entry.bytes > MAX_FILE || !digest_valid(&entry.sha256) { return Err("清单大小或摘要非法".into()); }
        total = total.checked_add(entry.bytes).ok_or("清单总量溢出")?;
        if total > MAX_BYTES { return Err("清单总量超限".into()); }
    }
    Ok(total)
}

fn digest_valid(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn copy_tree(source: &Path, target: &Path, tree: &Tree) -> Result<()> {
    validate_tree(tree)?;
    directory(target, false)?;
    let mut dirs = tree.directories.clone();
    dirs.sort(); // Parent sorts before descendants.
    for rel in dirs {
        directory(&child(source, &rel, false)?, false)?;
        fs::create_dir(child(target, &rel, true)?).map_err(io)?;
    }
    for entry in &tree.entries {
        let (bytes, digest) = hash_copy(&child(source, &entry.path, false)?, Some(&child(target, &entry.path, true)?), entry.bytes)?;
        if bytes != entry.bytes || digest != entry.sha256 { return Err(format!("复制期间文件改变: {}", entry.path)); }
    }
    if scan(target, false)? != *tree { return Err("复制结果校验失败".into()); }
    Ok(())
}

fn validate_learning(value: &Value) -> Result<()> {
    let object = value.as_object().ok_or("learning 必须为对象")?;
    if !object.get("articles").is_some_and(Value::is_object) || !object.get("cards").is_some_and(Value::is_array)
        || object.get("activity").is_some_and(|v| !v.is_object()) {
        return Err("learning 需要 articles 对象、cards 数组及可选 activity 对象".into());
    }
    Ok(())
}

/// Serialize into a bounded writer; do not allocate arbitrarily large JSON first.
fn encode_learning(value: &Value) -> Result<Vec<u8>> {
    validate_learning(value)?;
    struct Limited(Vec<u8>);
    impl Write for Limited {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.0.len() as u64 + buf.len() as u64 > MAX_LEARNING {
                return Err(std::io::Error::other("learning 超过 10 MiB"));
            }
            self.0.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    let mut writer = Limited(Vec::new());
    serde_json::to_writer(&mut writer, value).map_err(io)?;
    Ok(writer.0)
}

fn stage(base: &Path) -> Result<(String, PathBuf, PathBuf)> {
    let base = directory(base, true)?;
    let id = vault::unique_id();
    let staging = base.join(format!(".staging-{id}"));
    // create_dir is also the writeability probe and exclusive name reservation.
    fs::create_dir(&staging).map_err(|e| format!("备份/恢复目录不可写: {e}"))?;
    Ok((id.clone(), staging, base.join(id)))
}

/// Directory publication must not replace even an existing empty directory.
fn publish(staging: &Path, target: &Path) -> Result<()> {
    checked_path(staging, false)?;
    checked_path(target, true)?;
    match fs::symlink_metadata(target) {
        Ok(_) => return Err("发布目标已存在，拒绝覆盖".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(io(e)),
    }
    #[cfg(target_os = "linux")] {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        extern "C" { fn renameat2(olddirfd: i32, oldpath: *const std::ffi::c_char, newdirfd: i32, newpath: *const std::ffi::c_char, flags: u32) -> i32; }
        let src = CString::new(staging.as_os_str().as_bytes()).map_err(io)?;
        let dst = CString::new(target.as_os_str().as_bytes()).map_err(io)?;
        // RENAME_NOREPLACE; unsupported filesystems fail closed.
        if unsafe { renameat2(-100, src.as_ptr(), -100, dst.as_ptr(), 1) } != 0 { return Err(io(std::io::Error::last_os_error())); }
    }
    #[cfg(windows)]
    fs::rename(staging, target).map_err(io)?; // Windows never replaces a directory.
    #[cfg(not(any(windows, target_os = "linux")))]
    return Err("此平台尚不支持安全的目录发布".into());
    #[cfg(any(windows, target_os = "linux"))]
    {
        #[cfg(unix)]
        File::open(target.parent().ok_or("目标没有父目录")?).and_then(|f| f.sync_all()).map_err(io)?;
        Ok(())
    }
}

fn info(manifest: &Manifest, folder: &Path) -> BackupInfo {
    BackupInfo { id: manifest.id.clone(), created_ms: manifest.created_ms,
        // 历史清单里的 source_root 可能含 .. 或 verbatim 前缀，展示时统一规范化
        source_root: safe_path::clean_str(Path::new(&manifest.source_root)),
        files: manifest.files, bytes: manifest.bytes, path: safe_path::clean_str(folder) }
}

fn create_inner(base: &Path, root: &Path, expected_root: &str, learning: &Value) -> Result<BackupInfo> {
    create_with_preflight(base, root, expected_root, learning, || Ok(()))
}

fn create_with_preflight<F: FnOnce() -> Result<()>>(base: &Path, root: &Path, expected_root: &str, learning: &Value, preflight: F) -> Result<BackupInfo> {
    let source = directory(root, false)?;
    if directory(Path::new(expected_root), false)? != source { return Err("库根已变化，拒绝备份".into()); }
    disjoint_target(&source, base)?;
    let learning_bytes = encode_learning(learning)?;
    let before = scan(&source, true)?;
    let bytes = validate_tree(&before)?;
    let (id, staging, target) = stage(base)?;
    let knowledge = staging.join("knowledge");
    fs::create_dir(&knowledge).map_err(io)?;
    copy_tree(&source, &knowledge, &before)?;
    preflight()?;
    if scan(&source, true)? != before { return Err("备份期间库内容改变，请重试".into()); }
    let manifest = Manifest { version: 1, id, created_ms: vault::now_ms(), source_root: root.to_string_lossy().into_owned(),
        files: before.entries.len() as u64, bytes, learning_bytes: learning_bytes.len() as u64,
        learning_sha256: hash(&learning_bytes), tree: before };
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(io)?;
    if manifest_bytes.len() as u64 > MAX_MANIFEST { return Err("清单超过限额".into()); }
    write_new(&staging.join("learning.json"), &learning_bytes)?;
    write_new(&staging.join("manifest.json"), &manifest_bytes)?;
    // Verify the complete on-disk envelope before making it visible.
    verify(&staging, &manifest.id, true)?;
    publish(&staging, &target)?;
    Ok(info(&manifest, &target))
}

struct Verified { manifest: Manifest, manifest_bytes: Vec<u8>, learning_bytes: Vec<u8>, learning: Value }

fn verify(folder: &Path, id: &str, full: bool) -> Result<Verified> {
    id_valid(id)?;
    directory(folder, false)?;
    let mut envelope = HashSet::new();
    for entry in fs::read_dir(folder).map_err(io)? {
        let entry = entry.map_err(io)?;
        checked_path(&entry.path(), false)?;
        envelope.insert(entry.file_name().into_string().map_err(|_| "备份文件名非法")?);
    }
    if envelope != ["knowledge", "learning.json", "manifest.json"].into_iter().map(String::from).collect() {
        return Err("备份目录不完整或含有未登记条目".into());
    }
    let manifest_bytes = bounded_read(&folder.join("manifest.json"), MAX_MANIFEST)?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(io)?;
    if manifest.version != 1 || manifest.id != id { return Err("备份版本或 id 不符".into()); }
    let total = validate_tree(&manifest.tree)?;
    if manifest.files != manifest.tree.entries.len() as u64 || manifest.bytes != total
        || manifest.learning_bytes > MAX_LEARNING || !digest_valid(&manifest.learning_sha256) {
        return Err("清单数量、字节数或 learning 摘要不符".into());
    }
    let learning_bytes = bounded_read(&folder.join("learning.json"), MAX_LEARNING)?;
    if learning_bytes.len() as u64 != manifest.learning_bytes || hash(&learning_bytes) != manifest.learning_sha256 {
        return Err("learning 完整性校验失败".into());
    }
    let learning: Value = serde_json::from_slice(&learning_bytes).map_err(io)?;
    validate_learning(&learning)?;
    directory(&folder.join("knowledge"), false)?;
    if full && scan(&folder.join("knowledge"), false)? != manifest.tree { return Err("备份文件完整性校验失败".into()); }
    Ok(Verified { manifest, manifest_bytes, learning_bytes, learning })
}

pub(crate) fn list_inner(base: &Path) -> Result<Vec<BackupInfo>> {
    checked_path(base, true)?;
    if !base.try_exists().map_err(io)? { return Ok(Vec::new()); }
    let base = directory(base, false)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&base).map_err(io)? {
        let entry = entry.map_err(io)?;
        // Refuse links even if their names look like staging directories.
        checked_path(&entry.path(), false)?;
        let id = entry.file_name().into_string().map_err(|_| "备份 id 非 UTF-8")?;
        if id.starts_with(".staging-") { continue; }
        id_valid(&id)?;
        // Fail closed on malformed published entries; never silently omit them.
        // Full file hashing is deferred to restore, avoiding 1 GiB reads per list.
        let verified = verify(&entry.path(), &id, false)?;
        out.push(info(&verified.manifest, &entry.path()));
    }
    out.sort_by(|a, b| b.created_ms.cmp(&a.created_ms).then_with(|| b.id.cmp(&a.id)));
    Ok(out)
}

fn restore_inner(base: &Path, restored: &Path, id: &str) -> Result<RestoredBackup> {
    id_valid(id)?;
    let base = directory(base, false)?;
    let folder = base.join(id);
    let verified = verify(&folder, id, true)?;
    disjoint_target(&folder, restored)?;
    let (_, staging, target) = stage(restored)?;
    let knowledge = staging.join("knowledge");
    fs::create_dir(&knowledge).map_err(io)?;
    copy_tree(&folder.join("knowledge"), &knowledge, &verified.manifest.tree)?;
    // Detect edits/additions/deletions to backup files, learning or manifest during copy.
    let after = verify(&folder, id, true)?;
    if after.manifest_bytes != verified.manifest_bytes || after.learning_bytes != verified.learning_bytes {
        return Err("恢复期间备份被修改，请重试".into());
    }
    write_new(&staging.join("learning.json"), &verified.learning_bytes)?;
    write_new(&staging.join("manifest.json"), &verified.manifest_bytes)?;
    verify(&staging, id, true)?;
    publish(&staging, &target)?;
    Ok(RestoredBackup { path: safe_path::clean_str(&target.join("knowledge")), learning: verified.learning })
}

fn data_dir(app: &AppHandle) -> Result<PathBuf> { app.path().app_data_dir().map_err(io) }

#[tauri::command(async)]
pub fn create_backup(state: State<'_, AppState>, app: AppHandle, expected_root: String, learning: Value) -> Result<BackupInfo> {
    let _io = state.library_io.lock().map_err(io)?;
    let root = state.root.lock().map_err(io)?.clone();
    let backups = crate::storage::backups_dir(&app)?;
    create_inner(&backups, &root, &expected_root, &learning)
}

#[tauri::command(async)]
pub fn list_backups(state: State<'_, AppState>, app: AppHandle) -> Result<Vec<BackupInfo>> {
    let _io = state.library_io.lock().map_err(io)?;
    list_inner(&crate::storage::backups_dir(&app)?)
}

#[tauri::command(async)]
pub fn restore_backup(state: State<'_, AppState>, app: AppHandle, id: String) -> Result<RestoredBackup> {
    let _io = state.library_io.lock().map_err(io)?;
    let data = data_dir(&app)?;
    let root = state.root.lock().map_err(io)?.clone();
    // The current source is never a destination, even if configured as an app-data ancestor.
    disjoint_target(&root, &data.join("restored"))?;
    restore_inner(&crate::storage::backups_dir(&app)?, &data.join("restored"), &id)
}

#[cfg(test)]
#[path = "backup_tests.rs"]
mod tests;
