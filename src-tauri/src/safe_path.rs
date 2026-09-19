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

/// 面向展示与配置存储的路径规范化：去掉 Windows verbatim 前缀（\\?\、\\?\UNC\），
/// 词法解析 . 与 .. 分量，统一使用当前平台分隔符。纯字符串处理，不做磁盘访问，
/// 只用于展示与保存用户选择的路径，不能替代 checked_path 之类的安全校验。
pub fn clean(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    #[cfg(windows)]
    {
        let text = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { format!(r"\\{rest}") }
            else if let Some(rest) = text.strip_prefix(r"\\?\") { rest.to_string() }
            else { text.into_owned() };
        let unc = text.starts_with(r"\\");
        // "E:" 等盘符前缀是锚点，.. 不能越过它；UNC 的 server/share 同理。
        let floor = if unc { 2 } else if text.as_bytes().get(1) == Some(&b':') { 1 } else { 0 };
        let mut out: Vec<String> = Vec::new();
        for part in text.replace('/', "\\").split('\\') {
            if part.is_empty() || part == "." { continue; }
            if part == ".." {
                if out.len() > floor { out.pop(); }
                else if floor == 0 { out.push("..".into()); }
            } else { out.push(part.into()); }
        }
        let mut joined = out.join("\\");
        if unc { joined = format!(r"\\{joined}"); }
        PathBuf::from(joined)
    }
    #[cfg(not(windows))]
    {
        let absolute = text.starts_with('/');
        let mut out: Vec<&str> = Vec::new();
        for part in text.split('/') {
            if part.is_empty() || part == "." { continue; }
            if part == ".." {
                if out.last().is_some_and(|last| *last != "..") { out.pop(); }
                else if !absolute { out.push(".."); }
            } else { out.push(part); }
        }
        let joined = out.join("/");
        PathBuf::from(if absolute { format!("/{joined}") } else { joined })
    }
}

/// 展示用字符串版本。
pub fn clean_str(path: &Path) -> String { clean(path).to_string_lossy().into_owned() }

#[cfg(test)]
mod clean_tests {
    use super::*;

    #[test]
    fn cleans_verbatim_and_lexical_components() {
        // verbatim 前缀（canonicalize 产物）+ .. 分量 + 正反斜杠混用
        #[cfg(windows)]
        {
            assert_eq!(clean_str(Path::new(r"\\?\C:\Users\a\..\a\backups")), r"C:\Users\a\backups");
            assert_eq!(clean_str(Path::new(r"\\?\UNC\server\share\dir")), r"\\server\share\dir");
            assert_eq!(clean_str(Path::new("E:/AI/Learning/src-tauri/../knowledge")), r"E:\AI\Learning\knowledge");
            assert_eq!(clean_str(Path::new(r"E:\..\.\x")), r"E:\x"); // 不得越过盘符根
            assert_eq!(clean_str(Path::new(r"rel\..\sub\./x")), r"sub\x");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(clean_str(Path::new("/a/./b/../c")), "/a/c");
            assert_eq!(clean_str(Path::new("/..")), "/"); // 不得越过根
            assert_eq!(clean_str(Path::new("a/../..")), "..");
            assert_eq!(clean_str(Path::new("rel/./sub")), "rel/sub");
        }
    }
}
