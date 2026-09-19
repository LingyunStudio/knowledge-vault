//! 存储位置设置：知识库根目录与备份保存目录的用户可配置化。
//! config.json（app_local_data_dir）持久化 root 与 backups_dir；迁移 =
//! 扫描（逐文件 SHA-256）→ 复制 → 比对副本 → 复核原库，全部通过后才写配置并
//! 切换运行状态（root、root_info、watcher）。旧目录一律保留不动；任何一步失败
//! 都不会切换，目标目录中的残留副本不会被自动删除。
use crate::{root::RootInfo, safe_path, watcher, AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

type Result<T> = std::result::Result<T, String>;
fn io(e: impl std::fmt::Display) -> String { e.to_string() }

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct SavedConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    /// 用户在设置中显式选择过的知识库（区分资源拷贝等自动写入的 root）。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub root_explicit: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backups_dir: Option<String>,
}

pub fn config_dir(app: &AppHandle) -> Result<PathBuf> { app.path().app_local_data_dir().map_err(io) }

pub fn read_config(app: &AppHandle) -> SavedConfig {
    config_dir(app).ok()
        .and_then(|dir| fs::read_to_string(dir.join("config.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// 原子写入：临时文件 + 同目录重命名，避免半截配置。
pub fn write_config(app: &AppHandle, config: &SavedConfig) -> Result<()> {
    let dir = config_dir(app)?;
    fs::create_dir_all(&dir).map_err(io)?;
    let bytes = serde_json::to_vec(config).map_err(io)?;
    let tmp = dir.join(format!(".config-{}.tmp", crate::vault::unique_id()));
    {
        let mut file = fs::File::create(&tmp).map_err(io)?;
        file.write_all(&bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
    }
    fs::rename(&tmp, dir.join("config.json")).map_err(io)
}

/// 备份目录：用户配置优先，否则应用数据目录的 backups。
pub fn backups_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(match read_config(app).backups_dir {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_data_dir().map_err(io)?.join("backups"),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettings {
    pub knowledge_root: String,
    pub knowledge_source: String,
    pub knowledge_writable: bool,
    pub backups_dir: String,
    pub backups_dir_custom: bool,
}

#[tauri::command]
pub fn storage_settings(state: State<'_, AppState>, app: AppHandle) -> Result<StorageSettings> {
    let info = state.root_info.lock().map_err(io)?.clone();
    let config = read_config(&app);
    Ok(StorageSettings {
        knowledge_root: info.path,
        knowledge_source: info.source,
        knowledge_writable: info.writable,
        backups_dir: safe_path::clean_str(&backups_dir(&app)?),
        backups_dir_custom: config.backups_dir.is_some(),
    })
}

/// 用户输入路径的统一入口：清理展示形式（verbatim 前缀、. 与 ..、分隔符）并要求绝对路径。
fn absolute_dir(path: &str) -> Result<PathBuf> {
    let text = path.trim();
    if text.is_empty() { return Err("路径不能为空".into()); }
    let cleaned = safe_path::clean(Path::new(text));
    if !cleaned.is_absolute() { return Err("路径必须是绝对路径".into()); }
    Ok(cleaned)
}

/// a 与 b 相同或互为祖先/后代（词法比较；Windows 下忽略大小写与分隔符差异）。
fn conflicts(a: &Path, b: &Path) -> bool {
    let key = |p: &Path| -> String {
        let mut s = p.to_string_lossy().replace('\\', "/").to_string();
        while s.ends_with('/') { s.pop(); }
        #[cfg(windows)] { s.to_lowercase() }
        #[cfg(not(windows))] { s }
    };
    let (a, b) = (key(a), key(b));
    !a.is_empty() && !b.is_empty()
        && (a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/")))
}

/// 目标必须不存在或为空目录：迁移是完整复制，拒绝混入现有内容。
fn ensure_vacant(target: &Path) -> Result<()> {
    match fs::symlink_metadata(target) {
        Ok(meta) => {
            if safe_path::is_link(&meta) { return Err("拒绝符号链接/目录联接".into()); }
            if !meta.is_dir() { return Err("目标路径已存在且不是目录".into()); }
            if fs::read_dir(target).map_err(io)?.next().is_some() {
                return Err("目标目录已存在且非空；请选择一个空目录或尚未存在的路径".into());
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io(e)),
    }
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).map_err(io)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(io)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// 相对路径（POSIX 风格）→ 每个文件的 SHA-256；拒绝链接与非常规文件。
fn scan_hash(root: &Path) -> Result<BTreeMap<String, String>> {
    fn walk(root: &Path, rel: &str, map: &mut BTreeMap<String, String>) -> Result<()> {
        let dir = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
        for entry in fs::read_dir(&dir).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().into_string().map_err(|_| "路径含非 UTF-8 文件名")?;
            let meta = fs::symlink_metadata(entry.path()).map_err(io)?;
            if safe_path::is_link(&meta) { return Err(format!("拒绝符号链接/目录联接: {name}")); }
            let next = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            if meta.is_dir() {
                walk(root, &next, map)?;
            } else if meta.is_file() {
                map.insert(next, file_sha256(&entry.path())?);
            } else {
                return Err("拒绝非常规文件".into());
            }
        }
        Ok(())
    }
    let meta = fs::symlink_metadata(root).map_err(io)?;
    if safe_path::is_link(&meta) { return Err("拒绝符号链接/目录联接".into()); }
    if !meta.is_dir() { return Err("知识库根不是目录".into()); }
    let mut map = BTreeMap::new();
    walk(root, "", &mut map)?;
    Ok(map)
}

fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fn walk(source: &Path, target: &Path, rel: &str) -> Result<()> {
        let dir = if rel.is_empty() { source.to_path_buf() } else { source.join(rel) };
        for entry in fs::read_dir(&dir).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().into_string().map_err(|_| "路径含非 UTF-8 文件名")?;
            let meta = fs::symlink_metadata(entry.path()).map_err(io)?;
            if safe_path::is_link(&meta) { return Err(format!("拒绝符号链接/目录联接: {name}")); }
            let next = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            let to = target.join(&next);
            if meta.is_dir() {
                fs::create_dir(&to).map_err(io)?;
                walk(source, target, &next)?;
            } else if meta.is_file() {
                fs::copy(source.join(&next), &to).map_err(io)?;
            } else {
                return Err("拒绝非常规文件".into());
            }
        }
        Ok(())
    }
    fs::create_dir_all(target).map_err(io)?;
    walk(source, target, "")
}

/// 校验式迁移：扫描 → 复制 → 比对副本 → 复核原库。任何一步失败都不切换，
/// 原库未改动；目标目录中已复制的残留内容保留（不自动删除），重试前需手动清理。
fn migrate(source: &Path, target: &Path) -> Result<()> {
    let baseline = scan_hash(source)?;
    copy_tree(source, target)?;
    if scan_hash(target)? != baseline {
        return Err("迁移复制校验失败：目标内容与原库不一致。原库未改动，目标目录未启用。".into());
    }
    if scan_hash(source)? != baseline {
        return Err("迁移期间原库内容发生变化，已中止。原库未改动，目标目录未启用。".into());
    }
    Ok(())
}

/// 切换到新的知识库根目录：校验 → 完整复制并逐文件比对 → 写配置 → 切换状态
/// 与文件监听。原目录保留不动。学习记录由前端在新位置导入（不覆盖已有记录）。
/// 重 IO，(async) 使其在线程池执行，避免阻塞主线程冻结 UI。
#[tauri::command(async)]
pub fn set_knowledge_root(state: State<'_, AppState>, app: AppHandle, path: String) -> Result<RootInfo> {
    let _io = state.library_io.lock().map_err(io)?;
    let current = safe_path::clean(&state.root.lock().map_err(io)?.clone());
    let target = absolute_dir(&path)?;
    if current == target { return Err("新位置与当前知识库相同".into()); }

    // 与当前库、备份目录、恢复目录互相嵌套都会让备份/恢复语义失效。
    if conflicts(&current, &target) { return Err("新位置不能在当前知识库内部，也不能包含它".into()); }
    let backups = safe_path::clean(&backups_dir(&app)?);
    if conflicts(&backups, &target) { return Err("新位置不能与备份保存目录互相嵌套".into()); }
    let restored = app.path().app_data_dir().map_err(io)?.join("restored");
    if conflicts(&safe_path::clean(&restored), &target) { return Err("新位置不能与恢复副本目录互相嵌套".into()); }

    ensure_vacant(&target)?;
    migrate(&current, &target)?;

    let mut config = read_config(&app);
    config.root = Some(target.to_string_lossy().into_owned());
    config.root_explicit = true;
    write_config(&app, &config)?;

    let info = RootInfo {
        path: target.to_string_lossy().into_owned(),
        source: "config".into(),
        writable: crate::root::probe_writable(&target),
    };
    *state.root.lock().map_err(io)? = target;
    *state.root_info.lock().map_err(io)? = info.clone();
    // 旧监听随 guard 替换而停止（轮询线程通过停止标记退出）。
    let guard = watcher::start(app.clone(), state.root.lock().map_err(io)?.clone());
    *state.watcher.lock().map_err(io)? = Some(guard);
    Ok(info)
}

/// 更改备份保存目录。旧位置的备份不会被删除；可选择把已有备份复制到新位置。
#[tauri::command(async)]
pub fn set_backups_dir(state: State<'_, AppState>, app: AppHandle, path: String, migrate_existing: bool) -> Result<String> {
    let _io = state.library_io.lock().map_err(io)?;
    let target = absolute_dir(&path)?;
    let current = safe_path::clean(&backups_dir(&app)?);
    if current == target { return Ok(target.to_string_lossy().into_owned()); }

    let root = safe_path::clean(&state.root.lock().map_err(io)?.clone());
    let restored = safe_path::clean(&app.path().app_data_dir().map_err(io)?.join("restored"));
    if conflicts(&target, &root) { return Err("备份目录不能在知识库内部，也不能包含它".into()); }
    if conflicts(&target, &restored) { return Err("备份目录不能与恢复副本目录互相嵌套".into()); }

    ensure_vacant(&target)?;
    if migrate_existing && current.try_exists().map_err(io)? {
        copy_tree(&current, &target)?;
        if let Err(e) = crate::backup::list_inner(&target) {
            return Err(format!("备份迁移后校验失败：{e}。原位置未改动，新目录未启用。"));
        }
    }
    let mut config = read_config(&app);
    config.backups_dir = Some(target.to_string_lossy().into_owned());
    write_config(&app, &config)?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
