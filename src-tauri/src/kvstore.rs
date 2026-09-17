//! Durable recovery records. Each record is one atomically published JSON file;
//! no retention eviction: recovery data is never silently discarded.
use crate::{safe_path, vault};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub rel: String,
    #[serde(default)]
    pub current: Option<String>,
    pub created_ms: u64,
    pub reason: String,
    pub content: Vec<u8>,
}
fn kind(trash: bool) -> &'static str { if trash { "trash" } else { "history" } }
fn directory(root: &Path, trash: bool) -> Result<PathBuf, String> {
    safe_path::resolve(root, &format!(".kv/{}", kind(trash)), true)
}
fn entry_path(root: &Path, trash: bool, id: &str) -> Result<PathBuf, String> {
    let name = id.strip_prefix(&format!("{}/", kind(trash))).ok_or("条目 id 类型错误")?;
    safe_path::component(name, false)?;
    if name.contains('/') || !name.ends_with(".kv") { return Err("条目 id 无效".into()); }
    safe_path::resolve(root, &format!(".kv/{id}"), true)
}
pub fn write_entry(root: &Path, trash: bool, rel: &str, reason: &str, content: &[u8]) -> Result<String, String> {
    write_entry_inner(root, trash, rel, reason, content, None)
}
/// History entry for a move: `rel` records the old location, `current` the new one,
/// so restore-after-move targets the new path.
pub fn write_entry_with_rel(root: &Path, trash: bool, old_rel: &str, reason: &str, content: &[u8], current: &str) -> Result<String, String> {
    safe_path::article(root, current)?;
    let dir = directory(root, trash)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::fs::MetadataExt;
        #[link(name = "kernel32")]
        extern "system" { fn SetFileAttributesW(name: *const u16, attrs: u32) -> i32; }
        let parent = dir.parent().unwrap();
        let name: Vec<u16> = parent.as_os_str().encode_wide().chain(Some(0)).collect();
        let attrs = fs::metadata(parent).map_err(|e| e.to_string())?.file_attributes();
        if unsafe { SetFileAttributesW(name.as_ptr(), attrs | 2) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
    }
    let id = format!("{}/{}.kv", kind(trash), vault::unique_id());
    let path = entry_path(root, trash, &id)?;
    let entry = Entry { rel: old_rel.into(), created_ms: vault::now_ms(), reason: reason.into(), content: content.to_vec(), current: Some(current.into()) };
    let bytes = serde_json::to_vec(&entry).map_err(|e| e.to_string())?;
    vault::atomic_write(&path, &bytes, false, || Ok(())).map_err(|e| e.to_string())?;
    Ok(id)
}
fn write_entry_inner(root: &Path, trash: bool, rel: &str, reason: &str, content: &[u8], actual: Option<&str>) -> Result<String, String> {
    match actual {
        Some(current) => write_entry_with_rel(root, trash, rel, reason, content, current),
        None => write_entry_plain(root, trash, rel, reason, content),
    }
}
fn write_entry_plain(root: &Path, trash: bool, rel: &str, reason: &str, content: &[u8]) -> Result<String, String> {
    safe_path::article(root, rel)?;
    let dir = directory(root, trash)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Validate again after creation and before publication.
    directory(root, trash)?;
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::fs::MetadataExt;
        #[link(name = "kernel32")]
        extern "system" { fn SetFileAttributesW(name: *const u16, attrs: u32) -> i32; }
        let parent = dir.parent().unwrap();
        let name: Vec<u16> = parent.as_os_str().encode_wide().chain(Some(0)).collect();
        let attrs = fs::metadata(parent).map_err(|e| e.to_string())?.file_attributes();
        if unsafe { SetFileAttributesW(name.as_ptr(), attrs | 2) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
    }
    let id = format!("{}/{}.kv", kind(trash), vault::unique_id());
    let path = entry_path(root, trash, &id)?;
    let entry = Entry { rel: rel.into(), current: None, created_ms: vault::now_ms(), reason: reason.into(), content: content.to_vec() };
    let bytes = serde_json::to_vec(&entry).map_err(|e| e.to_string())?;
    vault::atomic_write(&path, &bytes, false, || Ok(())).map_err(|e| e.to_string())?;
    Ok(id)
}
pub fn read_entry(root: &Path, trash: bool, id: &str) -> Result<(String, Entry), String> {
    let path = entry_path(root, trash, id)?;
    let entry: Entry = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    // `current` records the article's present location (set on move); restore uses it.
    safe_path::article(root, entry.current.as_deref().unwrap_or(&entry.rel))?;
    Ok((id.into(), entry))
}
pub fn delete_entry(root: &Path, trash: bool, id: &str) -> Result<(), String> {
    fs::remove_file(entry_path(root, trash, id)?).map_err(|e| e.to_string())
}
pub fn list_entries(root: &Path, trash: bool) -> Result<Vec<(String, String, u64, u64, String)>, String> {
    let dir = directory(root, trash)?;
    let mut out = Vec::new();
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for item in rd {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".kv") { continue; }
        let id = format!("{}/{name}", kind(trash));
        let (_, e) = read_entry(root, trash, &id)?;
        out.push((id, e.rel, e.created_ms, e.content.len() as u64, e.reason));
    }
    out.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.0.cmp(&a.0)));
    Ok(out)
}
