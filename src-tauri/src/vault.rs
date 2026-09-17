//! Durable article operations. All IPC access is serialized by AppState.library_io.
//! Revisions are opaque disk metadata + content fingerprints, never embedded in articles.
use crate::{kvstore, library::{self, ArticleFileDto, WriteError}, safe_path};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};

static NEXT: AtomicU64 = AtomicU64::new(0);
pub fn unique_id() -> String {
    format!("{}-{}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(), std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))
}
pub fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
/// 内容修订号：mtime(纳秒)-字节数-内容哈希。仅用 mtime 判断会因毫秒精度碰撞漏检；
/// 哈希捕获同毫秒内的内容替换。文件首次出现在库中之前无历史，恢复目标用字面量 "missing"。
pub fn revision_of(text: &str, mtime_ms: u64) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    format!("{mtime_ms:x}-{:x}-{:016x}", text.len(), h.finish())
}
#[cfg(test)]
pub fn revision(bytes: &[u8], meta: &fs::Metadata) -> String {
    let text = String::from_utf8_lossy(bytes);
    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).unwrap_or_default().as_millis() as u64;
    revision_of(&text, modified)
}
fn io(e: impl ToString) -> WriteError { WriteError::Io(e.to_string()) }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntryDto { pub id: String, pub rel: String, pub created_ms: u64, pub bytes: u64 }
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntryDto { pub id: String, pub rel: String, pub created_ms: u64, pub bytes: u64, pub reason: String }
#[derive(Serialize, Debug)]
pub struct HistoryContentDto { pub entry: HistoryEntryDto, pub content: String }
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataUpdate { pub title: String, pub summary: String, pub order: i32, pub tags: Vec<String> }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MovedArticleDto { pub article: ArticleFileDto, pub updated_rels: Vec<String> }

/// No remove-then-rename window on Windows. ReplaceFileW requires the target to exist;
/// a concurrent deletion therefore fails rather than silently resurrecting it.
#[cfg(windows)]
fn replace(tmp: &Path, dest: &Path, existing: bool) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(replaced: *const u16, replacement: *const u16, backup: *const u16, flags: u32, exclude: *mut std::ffi::c_void, reserved: *mut std::ffi::c_void) -> i32;
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let src: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
    let dst: Vec<u16> = dest.as_os_str().encode_wide().chain(Some(0)).collect();
    // Temp is flushed and closed before replacement. Never fall back to deleting dest.
    let ok = unsafe {
        if existing { ReplaceFileW(dst.as_ptr(), src.as_ptr(), std::ptr::null(), 0, std::ptr::null_mut(), std::ptr::null_mut()) }
        else { MoveFileExW(src.as_ptr(), dst.as_ptr(), 8 /* WRITE_THROUGH, no overwrite */) }
    };
    if ok == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}
#[cfg(not(windows))]
fn replace(tmp: &Path, dest: &Path, existing: bool) -> std::io::Result<()> {
    if existing { fs::rename(tmp, dest) } else {
        // Atomic no-clobber publication on the same filesystem.
        fs::hard_link(tmp, dest)?;
        let _ = fs::remove_file(tmp);
        Ok(())
    }
}

/// Write and flush an exclusively created sibling temp, then atomically publish it.
/// Caller supplies a final preflight check (optimistic conflict/path validation).
pub fn atomic_write<F>(path: &Path, bytes: &[u8], existing: bool, preflight: F) -> Result<(), WriteError>
where F: FnOnce() -> Result<(), WriteError> {
    let parent = path.parent().ok_or(WriteError::InvalidRel)?;
    let tmp = parent.join(format!(".kv-{}.tmp", unique_id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(io)?;
        file.write_all(bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        drop(file);
        preflight()?;
        replace(&tmp, path, existing).map_err(io)?;
        #[cfg(not(windows))]
        if let Ok(dir) = fs::File::open(parent) { let _ = dir.sync_all(); }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&tmp); }
    result
}

pub fn check_expected(root: &Path, rel: &str, expected: Option<&str>, expected_ms: Option<u64>) -> Result<(), WriteError> {
    let path = safe_path::article(root, rel).map_err(|_| WriteError::InvalidRel)?;
    let disk = match library::read_article(root, rel) {
        Ok(d) => Some(d),
        Err(_) if !path.try_exists().map_err(io)? => None,
        Err(e) => return Err(io(e)),
    };
    let conflict = if let Some(rev) = expected {
        if rev == "missing" { disk.is_some() } else { disk.as_ref().map(|d| d.revision.as_str()) != Some(rev) }
    } else if let Some(ms) = expected_ms { disk.as_ref().map(|d| d.mtime_ms) != Some(ms) } else { false };
    if conflict { Err(WriteError::Conflict { disk }) } else { Ok(()) }
}

/// History is mandatory: if backup creation fails, the live article is untouched.
pub fn save(root: &Path, rel: &str, content: &str, expected: Option<&str>, expected_ms: Option<u64>, reason: &str) -> Result<ArticleFileDto, WriteError> {
    let path = safe_path::article(root, rel).map_err(|_| WriteError::InvalidRel)?;
    check_expected(root, rel, expected, expected_ms)?;
    let previous = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(io(e)),
    };
    if previous.as_deref() == Some(content.as_bytes()) { return library::read_article(root, rel).map_err(io); }
    // Pin the exact pre-save state even when force-save was requested, so races during backup
    // do not overwrite an external edit or recreate an externally deleted file.
    let pinned = library::read_article(root, rel).ok().map(|d| d.revision).unwrap_or_else(|| "missing".into());
    if let Some(bytes) = &previous { kvstore::write_entry(root, false, rel, reason, bytes).map_err(io)?; }
    atomic_write(&path, content.as_bytes(), previous.is_some(), || check_expected(root, rel, Some(&pinned), None))?;
    library::read_article(root, rel).map_err(io)
}

pub fn delete_article(root: &Path, rel: &str, expected: Option<&str>) -> Result<TrashEntryDto, WriteError> {
    let path = safe_path::article(root, rel).map_err(|_| WriteError::InvalidRel)?;
    check_expected(root, rel, expected, None)?;
    let current = library::read_article(root, rel).map_err(io)?;
    let bytes = fs::read(&path).map_err(io)?;
    let id = kvstore::write_entry(root, true, rel, "delete", &bytes).map_err(io)?;
    check_expected(root, rel, Some(&current.revision), None)?;
    fs::remove_file(&path).map_err(io)?;
    let (_, entry) = kvstore::read_entry(root, true, &id).map_err(io)?;
    Ok(TrashEntryDto { id, rel: rel.into(), created_ms: entry.created_ms, bytes: bytes.len() as u64 })
}
pub fn list_trash(root: &Path) -> Result<Vec<TrashEntryDto>, String> {
    Ok(kvstore::list_entries(root, true)?.into_iter().map(|(id, rel, created_ms, bytes, _)| TrashEntryDto { id, rel, created_ms, bytes }).collect())
}
pub fn restore_trash(root: &Path, id: &str, target: Option<&str>) -> Result<ArticleFileDto, WriteError> {
    let (_, entry) = kvstore::read_entry(root, true, id).map_err(io)?;
    let target = target.unwrap_or(&entry.rel);
    // Restoring elsewhere could break links; require the original path for now.
    if target != entry.rel { return Err(io("回收站仅支持恢复到原路径；恢复后可使用移动命令")); }
    let content = std::str::from_utf8(&entry.content).map_err(io)?;
    let article = save(root, target, content, Some("missing"), None, "restore-trash")?;
    // Retain the durable recovery entry if cleanup fails; the restored article is already safe.
    let _ = kvstore::delete_entry(root, true, id);
    Ok(article)
}
pub fn list_article_history(root: &Path, rel: &str) -> Result<Vec<HistoryEntryDto>, String> {
    safe_path::article(root, rel)?;
    Ok(kvstore::list_entries(root, false)?.into_iter().filter(|e| e.1 == rel).map(|(id, rel, created_ms, bytes, reason)| HistoryEntryDto { id, rel, created_ms, bytes, reason }).collect())
}
pub fn read_article_history(root: &Path, id: &str) -> Result<HistoryContentDto, String> {
    let (_, e) = kvstore::read_entry(root, false, id)?;
    Ok(HistoryContentDto { entry: HistoryEntryDto { id: id.into(), rel: e.rel, created_ms: e.created_ms, bytes: e.content.len() as u64, reason: e.reason }, content: String::from_utf8(e.content).map_err(|e| e.to_string())? })
}
pub fn restore_article_history(root: &Path, id: &str, expected: &str) -> Result<ArticleFileDto, WriteError> {
    let item = read_article_history(root, id).map_err(io)?;
    save(root, &item.entry.rel, &item.content, Some(expected), None, "pre-restore")
}

pub fn update_article_metadata(root: &Path, rel: &str, update: &MetadataUpdate, expected: &str) -> Result<ArticleFileDto, WriteError> {
    check_expected(root, rel, Some(expected), None)?;
    let path = safe_path::article(root, rel).map_err(|_| WriteError::InvalidRel)?;
    let text = fs::read_to_string(path).map_err(io)?;
    // Keep body bytes and unknown front matter lines intact. Refuse non-flat YAML rather than
    // treating continuations as independent fields and corrupting them.
    let (header, body) = crate::links::split_header(&text).map_err(io)?;
    let mut kept = Vec::new();
    if let Some(raw) = header {
        for line in raw.lines() {
            if line.trim().is_empty() || line.trim_start().starts_with('#') { kept.push(line.to_string()); continue; }
            if line.starts_with([' ', '\t']) || !line.contains(':') { return Err(io("元数据更新仅支持平面单行 front matter")); }
            let (key, value) = line.split_once(':').unwrap();
            if value.trim().starts_with(['|', '>', '&', '*']) { return Err(io("不支持多行或引用 YAML 元数据")); }
            if !matches!(key.trim(), "title" | "summary" | "description" | "order" | "tags" | "keywords") { kept.push(line.to_string()); }
        }
    }
    if update.title.chars().chain(update.summary.chars()).any(|c| c.is_control()) || update.tags.iter().any(|t| t.chars().any(|c| c.is_control() || [',', '，', '、'].contains(&c))) {
        return Err(io("标题/摘要必须单行，标签不能包含控制字符或逗号分隔符"));
    }
    let scalar = |s: &str| serde_json::to_string(s).unwrap();
    kept.push(format!("title: {}", scalar(&update.title)));
    kept.push(format!("summary: {}", scalar(&update.summary)));
    kept.push(format!("order: {}", update.order));
    kept.push(format!("tags: {}", scalar(&update.tags.join(", "))));
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let bom = if text.starts_with('\u{feff}') { "\u{feff}" } else { "" };
    let content = format!("{bom}---{eol}{}{eol}---{eol}{body}", kept.join(eol));
    save(root, rel, &content, Some(expected), None, "metadata")
}

/// Conservative single-article move: refuse incoming links rather than performing a
/// non-atomic multi-document transaction. Both original bytes and rebased bytes are
/// durably backed up before publication. A crash may leave both paths, never neither.
pub fn move_article(root: &Path, rel: &str, target_rel: &str, expected: &str) -> Result<MovedArticleDto, WriteError> {
    if rel.eq_ignore_ascii_case(target_rel) { return Err(io("不支持相同路径或仅大小写重命名")); }
    let source = safe_path::article(root, rel).map_err(|_| WriteError::InvalidRel)?;
    let dest = safe_path::article(root, target_rel).map_err(|_| WriteError::InvalidRel)?;
    check_expected(root, rel, Some(expected), None)?;
    check_expected(root, target_rel, Some("missing"), None)?;
    if !dest.parent().is_some_and(|p| p.is_dir()) { return Err(io("目标板块/分组必须已存在")); }
    let before = crate::links::articles(root).map_err(io)?;
    for (other, text) in &before {
        if other == rel { continue; }
        let (targets, warnings) = crate::links::extract(text).map_err(io)?;
        if !warnings.is_empty() { return Err(io(format!("{other}: 无法排除不支持语法中的入链（{}）", warnings.join("；")))); }
        for t in targets {
            if crate::links::normalize(root, other, &text[t.start..t.end]).map_err(io)?.is_some_and(|r| r.eq_ignore_ascii_case(rel)) {
                return Err(io(format!("{other} 引用了此文章；暂不支持跨文章原子改写，请先处理入链")));
            }
        }
    }
    let text = fs::read_to_string(&source).map_err(io)?;
    let rewritten = crate::links::rewrite_outgoing(root, rel, target_rel, &text).map_err(io)?;
    // Validate the entire library again before publication: externally edited incoming
    // references must not be silently missed while preparing the move.
    kvstore::write_entry(root, false, rel, "move-source", text.as_bytes()).map_err(io)?;
    kvstore::write_entry(root, false, target_rel, "move-target", rewritten.as_bytes()).map_err(io)?;
    atomic_write(&dest, rewritten.as_bytes(), false, || {
        check_expected(root, rel, Some(expected), None)?;
        check_expected(root, target_rel, Some("missing"), None)?;
        if crate::links::articles(root).map_err(io)? != before { return Err(io("扫描期间知识库发生变化，请重试移动")); }
        Ok(())
    })?;
    // Recheck source before deletion; if an external edit happened retain both files and
    // return conflict, preserving both versions for explicit user reconciliation.
    check_expected(root, rel, Some(expected), None)?;
    fs::remove_file(&source).map_err(|e| io(format!("目标已创建，源文件未删除（两个版本均保留）：{e}")))?;
    Ok(MovedArticleDto { article: library::read_article(root, target_rel).map_err(io)?, updated_rels: vec![rel.into(), target_rel.into()] })
}
