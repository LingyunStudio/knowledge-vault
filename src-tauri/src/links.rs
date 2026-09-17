//! Deliberately bounded Markdown parser. Only ordinary inline links/images are
//! rewritten. Unsupported non-code syntax is reported, never silently rewritten.
use crate::safe_path;
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArticleLinkDto {
    pub source_rel: String, pub destination: String, pub target_rel: Option<String>,
    pub kind: String, pub exists: Option<bool>,
}
#[derive(Serialize, Debug)]
pub struct LinkScanDto { pub links: Vec<ArticleLinkDto>, pub warnings: Vec<String> }
#[derive(Debug)]
pub struct Target { pub start: usize, pub end: usize, pub image: bool }

/// Return header and exact body slice, without stripping body whitespace.
pub fn split_header(text: &str) -> Result<(Option<&str>, &str), String> {
    let t = text.trim_start_matches('\u{feff}');
    let first_end = t.find('\n').unwrap_or(t.len());
    if t[..first_end].trim_end_matches('\r') != "---" { return Ok((None, t)); }
    let start = (first_end + 1).min(t.len());
    let mut at = start;
    for line in t[start..].split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return Ok((Some(t[start..at].trim_end_matches(['\r', '\n'])), &t[at + line.len()..]));
        }
        at += line.len();
    }
    Err("未闭合的 front matter".into())
}

/// Mask fenced/indented code and inline backtick spans while preserving byte offsets.
fn mask_code(text: &str) -> Vec<u8> {
    let mut mask = text.as_bytes().to_vec();
    let mut at = 0;
    let mut fence: Option<(u8, usize)> = None;
    for line in text.split_inclusive('\n') {
        let b = line.as_bytes();
        let indent = b.iter().take_while(|&&x| x == b' ').count();
        let trim = &b[indent..];
        let marker = trim.first().copied().unwrap_or(0);
        let run = trim.iter().take_while(|&&x| x == marker).count();
        let fence_line = indent <= 3 && matches!(marker, b'`' | b'~') && run >= 3;
        let mut masked = fence.is_some() || indent >= 4 || b.first() == Some(&b'\t');
        if let Some((c, n)) = fence {
            if fence_line && marker == c && run >= n && trim[run..].iter().all(|b| b.is_ascii_whitespace()) { fence = None; }
        } else if fence_line { fence = Some((marker, run)); masked = true; }
        if masked { mask[at..at + b.len()].fill(b' '); }
        at += b.len();
    }
    let mut i = 0;
    while i < mask.len() {
        if mask[i] != b'`' { i += 1; continue; }
        let n = mask[i..].iter().take_while(|&&x| x == b'`').count();
        let mut j = i + n;
        let mut end = None;
        while j < mask.len() {
            if mask[j] == b'`' {
                let run = mask[j..].iter().take_while(|&&x| x == b'`').count();
                if run == n { end = Some(j + run); break; }
                j += run;
            } else { j += 1; }
        }
        if let Some(end) = end { mask[i..end].fill(b' '); i = end; } else { i += n; }
    }
    mask
}

pub fn extract(text: &str) -> Result<(Vec<Target>, Vec<String>), String> {
    if text.len() > 4 * 1024 * 1024 { return Err("文章超过链接扫描上限 4 MiB".into()); }
    let (header, body) = split_header(text)?;
    let offset = text.len() - body.len();
    let mut warnings = Vec::new();
    if header.is_some_and(|h| h.contains('[') || h.contains("src=") || h.contains("href=")) {
        warnings.push("front matter 含可能的链接引用".into());
    }
    let mask = mask_code(body);
    let mut targets = Vec::new();
    let mut i = 0;
    while i < mask.len() {
        if mask[i] == b'\\' { warnings.push("转义 Markdown 未纳入自动改写".into()); i += 2; continue; }
        if mask[i] == b'<' { warnings.push("HTML/自动链接未纳入自动改写".into()); i += 1; continue; }
        if mask[i] != b'[' { i += 1; continue; }
        let image = i > 0 && mask[i - 1] == b'!';
        let start_label = i + 1;
        let Some(close) = mask[start_label..].iter().position(|&b| b == b']').map(|n| start_label + n) else {
            warnings.push("未闭合的方括号".into()); break;
        };
        if mask[start_label..close].contains(&b'[') || mask[start_label..close].contains(&b'\\') {
            warnings.push("嵌套链接/wiki 链接不支持自动改写".into()); i = close + 1; continue;
        }
        if mask.get(close + 1) != Some(&b'(') {
            warnings.push("引用式/快捷链接不支持自动改写".into()); i = close + 1; continue;
        }
        let mut p = close + 2;
        while mask.get(p).is_some_and(|b| b.is_ascii_whitespace()) { p += 1; }
        let angle = mask.get(p) == Some(&b'<');
        if angle { p += 1; }
        let start = p;
        let mut depth = 0usize;
        while p < mask.len() {
            let c = mask[p];
            if c == b'\\' { break; }
            if angle { if c == b'>' { break; } }
            else {
                if c == b'(' { depth += 1; }
                if c == b')' { if depth == 0 { break; } depth -= 1; }
                if c.is_ascii_whitespace() { break; }
            }
            p += 1;
        }
        let end = p;
        if angle && mask.get(p) == Some(&b'>') { p += 1; }
        while mask.get(p).is_some_and(|b| b.is_ascii_whitespace()) { p += 1; }
        // Optional ordinary quoted title. Other forms are deliberately unsupported.
        if matches!(mask.get(p), Some(b'"' | b'\'')) {
            let quote = mask[p]; p += 1;
            while p < mask.len() && mask[p] != quote && mask[p] != b'\\' { p += 1; }
            if mask.get(p) == Some(&quote) { p += 1; }
            while mask.get(p).is_some_and(|b| b.is_ascii_whitespace()) { p += 1; }
        }
        if mask.get(p) != Some(&b')') || end == start || body.as_bytes()[start..end].iter().any(|&b| matches!(b, b'\r' | b'\n')) {
            warnings.push("链接目标/标题语法不支持自动改写".into()); i = close + 2; continue;
        }
        targets.push(Target { start: offset + start, end: offset + end, image });
        i = p + 1;
    }
    warnings.sort(); warnings.dedup();
    Ok((targets, warnings))
}

fn decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes(); let mut out = Vec::new(); let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = b.get(i + 1..i + 3).ok_or("URL 百分号编码无效")?;
            let value = u8::from_str_radix(std::str::from_utf8(hex).map_err(|_| "URL 编码无效")?, 16).map_err(|_| "URL 编码无效")?;
            out.push(value); i += 3;
        } else { out.push(b[i]); i += 1; }
    }
    String::from_utf8(out).map_err(|_| "URL 不是 UTF-8".into())
}
fn external(dest: &str) -> bool {
    dest.starts_with('#') || dest.starts_with("//") || dest.split('/').next().unwrap_or("").contains(':')
}
/// Resolve conventional article-relative and library-root-relative targets. Unsafe targets error.
pub fn normalize(root: &Path, source: &str, dest: &str) -> Result<Option<String>, String> {
    if external(dest) || dest.is_empty() { return Ok(None); }
    let path = dest.split(['#', '?']).next().unwrap_or("");
    if path.is_empty() { return Ok(None); }
    let decoded = decode(path)?;
    let mut parts: Vec<&str> = if decoded.starts_with('/') { Vec::new() } else { source.split('/').collect() };
    if !decoded.starts_with('/') { parts.pop(); }
    for part in decoded.split('/') {
        match part { "" | "." => {}, ".." => { parts.pop().ok_or("链接超出知识库")?; }, p => parts.push(p) }
    }
    let rel = parts.join("/");
    safe_path::resolve(root, &rel, false)?;
    Ok(Some(rel))
}
fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"/-._~".contains(&b) { out.push(b as char); }
        else { out.push_str(&format!("%{b:02X}")); }
    }
    out
}
fn relative(from: &str, target: &str) -> String {
    let mut a: Vec<_> = from.split('/').collect(); a.pop();
    let b: Vec<_> = target.split('/').collect();
    let shared = a.iter().zip(&b).take_while(|(a, b)| a == b).count();
    format!("{}{}", "../".repeat(a.len() - shared), b[shared..].join("/"))
}

pub fn rewrite_outgoing(root: &Path, source: &str, dest: &str, text: &str) -> Result<String, String> {
    let (targets, warnings) = extract(text)?;
    if !warnings.is_empty() { return Err(format!("{source}: {}", warnings.join("；"))); }
    let mut out = text.to_string();
    for target in targets.iter().rev() {
        let raw = &text[target.start..target.end];
        let Some(mut resolved) = normalize(root, source, raw)? else { continue; };
        if resolved.eq_ignore_ascii_case(source) { resolved = dest.into(); }
        let suffix = raw.find(['#', '?']).map(|i| &raw[i..]).unwrap_or("");
        let new = if raw.starts_with('/') { format!("/{}", encode(&resolved)) } else { encode(&relative(dest, &resolved)) };
        out.replace_range(target.start..target.end, &format!("{new}{suffix}"));
    }
    Ok(out)
}

/// Strict traversal for move/index, never follows links and never silently skips unreadable articles.
pub fn articles(root: &Path) -> Result<Vec<(String, String)>, String> {
    fn visit(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) -> Result<(), String> {
        for e in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(['.', '_']) { continue; }
            let meta = fs::symlink_metadata(e.path()).map_err(|e| e.to_string())?;
            if safe_path::is_link(&meta) { return Err("库内存在符号链接/联接，拒绝链接扫描或移动".into()); }
            if meta.is_dir() { visit(root, &e.path(), out)?; }
            else if name.ends_with(".md") {
                if out.len() >= 10000 || meta.len() > 4 * 1024 * 1024 { return Err("链接扫描超过上限（10000 篇，每篇 4 MiB）".into()); }
                let rel = e.path().strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
                safe_path::article(root, &rel)?;
                out.push((rel, fs::read_to_string(e.path()).map_err(|e| e.to_string())?));
            }
        }
        Ok(())
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut out = Vec::new(); visit(&root, &root, &mut out)?; Ok(out)
}
pub fn list_article_links(root: &Path) -> Result<LinkScanDto, String> {
    let mut result = LinkScanDto { links: Vec::new(), warnings: Vec::new() };
    for (rel, text) in articles(root)? {
        let (targets, warnings) = extract(&text)?;
        result.warnings.extend(warnings.into_iter().map(|w| format!("{rel}: {w}")));
        for t in targets {
            let raw = &text[t.start..t.end];
            let target_rel = match normalize(root, &rel, raw) { Ok(r) => r, Err(e) => { result.warnings.push(format!("{rel}: {e}")); None } };
            let exists = target_rel.as_ref().map(|p| safe_path::resolve(root, p, false).is_ok_and(|p| p.is_file()));
            result.links.push(ArticleLinkDto { source_rel: rel.clone(), destination: raw.into(), target_rel, kind: if t.image { "image" } else { "link" }.into(), exists });
        }
    }
    Ok(result)
}
