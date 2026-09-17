//! Shared library-only path validation. Never follow symlinks/junctions below root.
use std::{fs, path::{Path, PathBuf}};

pub fn component(s: &str, internal: bool) -> Result<(), String> {
    let reserved = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if s.is_empty() || s == "." || s == ".." || s.ends_with(['.', ' '])
        || s.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        || (!internal && s.starts_with(['.', '_']))
        || matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (reserved.len() == 4 && (reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && matches!(reserved.as_bytes()[3], b'1'..=b'9')) {
        return Err(format!("非法路径段: {s}"));
    }
    Ok(())
}

pub fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))] { meta.file_type().is_symlink() }
}

pub fn resolve(root: &Path, rel: &str, internal: bool) -> Result<PathBuf, String> {
    if rel.contains('\\') { return Err("路径必须使用 /".into()); }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut result = root.clone();
    for part in rel.split('/') {
        component(part, internal)?;
        result.push(part);
        match fs::symlink_metadata(&result) {
            Ok(meta) => {
                if is_link(&meta) { return Err("不允许符号链接或目录联接".into()); }
                if !result.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) {
                    return Err("路径越界".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(result)
}

pub fn article(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.split('/').count() < 2 || !rel.ends_with(".md") { return Err("仅允许板块内 .md 文章".into()); }
    resolve(root, rel, false)
}
