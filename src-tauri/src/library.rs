//! 知识库内容层：扫描 `knowledge/` 目录、解析 front matter、提供 DTO。
//!
//! 移植自旧 egui 版 src/content.rs（扫描口径、排序、YAML 兼容逐行保留），
//! 唯一结构差异：brand 色由 egui::Color32 改为标准化后的 `#rrggbb` 字符串，
//! 正文按需读取（扫描期只产出搜索用纯文本）。

use serde::Serialize;
use std::fs;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::safe_path;

/// 板块元信息：从板块目录下的 `_section.md` front matter 读取。
#[derive(Serialize, Clone, Debug)]
pub struct SectionDto {
    pub id: String,
    pub name: String,
    /// 无 logo 文件时的兜底字符
    pub glyph: String,
    pub desc: String,
    /// 品牌色，标准化为 `#rrggbb`
    pub brand: Option<String>,
    pub order: i32,
    /// 是否有封面图（cover.{png,jpg,jpeg,webp,gif}）
    #[serde(rename = "hasCover")]
    pub has_cover: bool,
}

/// 文章元数据（扫描列表用，含搜索纯文本）。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArticleMetaDto {
    pub rel: String,
    pub file_name: String,
    /// 所属子目录分组（相对板块目录，POSIX 风格），根目录文章为 None
    pub group: Option<String>,
    pub sec_id: String,
    pub title: String,
    pub summary: String,
    pub order: i32,
    pub tags: Vec<String>,
    pub mtime_ms: u64,
    /// 纯文本版正文，供前端全文搜索
    pub plain: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDto {
    pub sections: Vec<SectionDto>,
    pub articles: Vec<ArticleMetaDto>,
}

/// 读取单篇文章：front matter 与正文分离。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArticleFileDto {
    pub rel: String,
    /// 两个 `---` 之间的 front matter 原文（不含定界行），无 front matter 时为 None
    pub fm_raw: Option<String>,
    pub title: String,
    pub summary: String,
    pub order: i32,
    pub tags: Vec<String>,
    /// 去掉 front matter 的正文
    pub body: String,
    pub mtime_ms: u64,
    /// 内容修订号（mtime 纳秒-长度-内容哈希）。保存/移动/元数据更新后变化。
    pub revision: String,
}

pub const SECTION_META_FILE: &str = "_section.md";

/// 板块封面：固定探测 `cover.{png,jpg,jpeg,webp,gif}`。
pub const COVER_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

pub fn cover_file(dir: &Path) -> Option<&'static str> {
    COVER_EXTS
        .iter()
        .find(|e| dir.join(format!("cover.{e}")).is_file())
        .copied()
}

#[derive(Default)]
struct SectionInfo {
    name: Option<String>,
    desc: Option<String>,
    brand: Option<String>,
    glyph: Option<String>,
    order: Option<i32>,
}

fn parse_section_meta(dir: &Path) -> SectionInfo {
    let mut info = SectionInfo::default();
    let Ok(text) = fs::read_to_string(dir.join(SECTION_META_FILE)) else {
        return info;
    };
    let t = text.trim_start_matches('\u{feff}').trim_start();
    if !t.starts_with("---") {
        return info;
    }
    let Some(end) = t[3..].find("\n---") else {
        return info;
    };
    for line in t[3..3 + end].lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let v = v
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        if v.is_empty() {
            continue;
        }
        match k.trim().to_ascii_lowercase().as_str() {
            "name" | "title" => info.name = Some(v),
            "desc" | "description" | "summary" => info.desc = Some(v),
            "brand" | "color" => info.brand = normalize_hex(&v),
            "glyph" => info.glyph = Some(v),
            "order" => info.order = v.parse().ok(),
            _ => {}
        }
    }
    info
}

/// 把 `#rgb` 展开为 `#rrggbb`，`#rrggbb` 原样返回（小写）；非法返回 None。
fn normalize_hex(s: &str) -> Option<String> {
    let h = s.trim().trim_start_matches('#');
    if !h.is_ascii() {
        return None;
    }
    let comp = |hi: usize| u8::from_str_radix(&h[hi..hi + 2], 16).ok();
    let (r, g, b) = match h.len() {
        6 => (comp(0)?, comp(2)?, comp(4)?),
        3 => {
            let d =
                |i: usize| u8::from_str_radix(&h[i..i + 1], 16).ok().map(|v| v * 17);
            (d(0)?, d(1)?, d(2)?)
        }
        _ => return None,
    };
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

#[derive(Default, Clone)]
pub struct FrontMatter {
    pub title: Option<String>,
    pub order: i32,
    pub tags: Vec<String>,
    pub summary: String,
}

/// 解析 `--- ... ---` 包裹的简易 front matter，
/// 返回 (字段, 定界符之间的原文, 正文)。
pub fn split_front_matter(text: &str) -> (FrontMatter, Option<String>, String) {
    let mut fm = FrontMatter::default();
    let t = text.trim_start_matches('\u{feff}').trim_start();
    if !t.starts_with("---") {
        return (fm, None, t.to_string());
    }
    let Some(end) = t[3..].find("\n---") else {
        return (fm, None, t.to_string());
    };
    let header = &t[3..3 + end];
    let body = t[3 + end + 4..]
        .trim_start_matches('\r')
        .trim_start_matches('\n');
    for line in header.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let v = v
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match k.trim() {
            "title" => fm.title = Some(v),
            "order" => fm.order = v.parse().unwrap_or(999),
            "summary" | "description" => fm.summary = v,
            "tags" | "keywords" => {
                fm.tags = v
                    .split(|c: char| c == ',' || c == '，' || c == '、')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect();
            }
            _ => {}
        }
    }
    // 去掉 header 首尾空行，保留其余行原样
    let raw = header.trim_matches(['\n', '\r']).to_string();
    (fm, Some(raw), body.to_string())
}

/// 剥离 Markdown 装饰语法，得到适合搜索与摘要的纯文本。
fn strip_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_code_fence = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with("```") {
            in_code_fence = !in_code_fence;
            out.push_str(l.trim_start_matches('`'));
            out.push(' ');
            continue;
        }
        if in_code_fence {
            out.push_str(line);
            out.push(' ');
            continue;
        }
        let s = l.trim_start_matches(['#', '>', ' ', '\t', '-', '+', '*', '|']);
        let s = s.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ')');
        out.push_str(s.trim_start());
        out.push(' ');
    }
    strip_inline_tags(
        &out
            .replace("**", "")
            .replace("__", "")
            .replace("~~", "")
            .replace('`', "")
            .replace("](", " ")
            .replace('[', ""),
    )
}

/// 移除行内 `<span ...>` / `</span>` 标签（颜色/背景色标记），保留内容。
fn strip_inline_tags(s: &str) -> String {
    let s = s.replace("</span>", "");
    let mut cleaned = String::with_capacity(s.len());
    let mut rest = s.as_str();
    while let Some(pos) = rest.find("<span") {
        cleaned.push_str(&rest[..pos]);
        let after = &rest[pos..];
        match after.find('>') {
            Some(end) => rest = &after[end + 1..],
            None => {
                rest = after;
                break;
            }
        }
    }
    cleaned.push_str(rest);
    cleaned
}

fn mtime_ms_of(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 递归收集目录树下的 md 文章；`sub` 是相对板块目录的子路径（"" 表示根）。
/// 隐藏目录（`.`/`_` 开头）跳过，`_` 开头的 md 跳过。
fn collect_articles(
    dir: &Path,
    sec_id: &str,
    sub: &str,
    out: &mut Vec<ArticleMetaDto>,
) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        if p.is_dir() {
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            let child_sub = if sub.is_empty() {
                name
            } else {
                format!("{sub}/{name}")
            };
            collect_articles(&p, sec_id, &child_sub, out);
        } else if p.extension().and_then(|x| x.to_str()) == Some("md") {
            if name.starts_with('_') {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            let mtime_ms = mtime_ms_of(&meta);
            let Ok(text) = fs::read_to_string(&p) else {
                continue;
            };
            let (fm, _, body) = split_front_matter(&text);
            let plain = strip_markdown(&body);
            let rel = if sub.is_empty() {
                format!("{sec_id}/{name}")
            } else {
                format!("{sec_id}/{sub}/{name}")
            };
            let group = if sub.is_empty() {
                None
            } else {
                Some(sub.to_string())
            };
            out.push(ArticleMetaDto {
                rel,
                file_name: name,
                group,
                sec_id: sec_id.to_string(),
                title: fm.title.unwrap_or_else(|| {
                    p.file_stem().unwrap().to_string_lossy().to_string()
                }),
                summary: fm.summary,
                order: fm.order,
                tags: fm.tags,
                mtime_ms,
                plain,
            });
        }
    }
}

/// 扫描整个知识库：板块按 order→id、文章按 group→order→title 排序。
pub fn scan(root: &Path) -> LibraryDto {
    let mut sections = Vec::new();
    let mut articles = Vec::new();

    let mut dir_ids: Vec<String> = fs::read_dir(root)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().is_dir()
                        && !e.file_name().to_string_lossy().starts_with('.')
                })
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    dir_ids.sort();

    for id in &dir_ids {
        let sec_dir = root.join(id);
        let info = parse_section_meta(&sec_dir);
        let mut name_default = id.clone();
        if let Some(c) = name_default.get_mut(0..1) {
            c.make_ascii_uppercase();
        }
        sections.push(SectionDto {
            id: id.clone(),
            name: info.name.unwrap_or(name_default),
            glyph: info.glyph.unwrap_or_else(|| id.chars().take(2).collect()),
            desc: info.desc.unwrap_or_default(),
            brand: info.brand,
            order: info.order.unwrap_or(i32::MAX),
            has_cover: cover_file(&sec_dir).is_some(),
        });
        collect_articles(&sec_dir, id, "", &mut articles);
    }

    articles.sort_by(|a, b| {
        a.group
            .as_deref()
            .unwrap_or("")
            .cmp(b.group.as_deref().unwrap_or(""))
            .then_with(|| a.order.cmp(&b.order))
            .then_with(|| a.title.cmp(&b.title))
    });
    sections.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then_with(|| a.id.cmp(&b.id))
    });

    LibraryDto { sections, articles }
}

/// 把前端传入的 rel（POSIX 相对路径）解析为 root 下的安全路径。
/// `allow_meta` 为 true 时允许 `_` 开头的文件（仅测试兼容；运行时统一走 safe_path）。
#[cfg(test)]
pub fn resolve_rel(root: &Path, rel: &str, allow_meta: bool) -> Result<std::path::PathBuf, String> {    let rel = rel.replace('\\', "/");
    if rel.is_empty() {
        return Err("空路径".into());
    }
    let mut p = PathBuf::new();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." || seg.contains(':') {
            return Err(format!("非法路径段: {seg}"));
        }
        p.push(seg);
    }
    if p.extension().and_then(|s| s.to_str()) != Some("md") {
        return Err("仅允许 .md 文件".into());
    }
    if !allow_meta
        && p
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('_'))
            .unwrap_or(true)
    {
        return Err("不允许访问 _ 开头的元信息文件".into());
    }
    let full = root.join(&p);
    // 结构上已经不可能逃出 root（无 .. / 绝对路径），再用前缀双保险
    if !full.starts_with(root) {
        return Err("路径越界".into());
    }
    Ok(full)
}

/// 读取单篇文章并拆分 front matter。
pub fn read_article(root: &Path, rel: &str) -> Result<ArticleFileDto, String> {
    let path = safe_path::article(root, rel)?;
    if !path.is_file() {
        return Err("文章不存在".into());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))?;
    let mtime_ms = fs::metadata(&path).map(|m| mtime_ms_of(&m)).unwrap_or(0);
    let (fm, fm_raw, body) = split_front_matter(&text);
    Ok(ArticleFileDto {
        rel: rel.to_string(),
        fm_raw,
        title: fm.title.unwrap_or_default(),
        summary: fm.summary,
        order: fm.order,
        tags: fm.tags,
        body,
        mtime_ms,
        revision: crate::vault::revision_of(&text, mtime_ms),
    })
}

/// 整篇写回（仅测试兼容保留；运行时统一走 vault::save 的原子+留档路径）。
#[cfg(test)]
pub fn write_article(
    root: &Path,
    rel: &str,
    content: &str,
    expected_ms: Option<u64>,
) -> Result<u64, WriteError> {
    let path = resolve_rel(root, rel, false).map_err(|_| WriteError::InvalidRel)?;
    if let Some(expected) = expected_ms {
        if let Ok(meta) = fs::metadata(&path) {
            if mtime_ms_of(&meta) != expected {
                let disk = read_article(root, rel).ok();
                return Err(WriteError::Conflict { disk });
            }
        }
    }
    fs::write(&path, content).map_err(|e| WriteError::Io(e.to_string()))?;
    let mtime_ms = fs::metadata(&path)
        .map(|m| mtime_ms_of(&m))
        .unwrap_or_else(|_| now_ms());
    Ok(mtime_ms)
}

/// 删除单篇文章（不可恢复；仅限普通 md 文件）。
#[cfg(test)]
pub fn delete_article(root: &Path, rel: &str) -> Result<(), String> {
    let path = resolve_rel(root, rel, false).map_err(|e| format!("无法删除：{e}"))?;
    fs::remove_file(&path).map_err(|e| format!("删除失败：{e}"))
}

/// 清理文件/目录名：替换 Windows 非法字符，去掉首尾空白与点。
fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect();
    cleaned
        .trim()
        .trim_matches('.')
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 在板块下创建新文章：文件名由标题清理而来，重名自动加序号，
/// front matter 只写 title。返回新文章的 rel。
pub fn create_article(root: &Path, sec_id: &str, title: &str) -> Result<String, String> {
    let sec = sanitize_component(sec_id);
    if sec.is_empty() {
        return Err("板块标识无效".into());
    }
    let dir = root.join(&sec);
    if !dir.is_dir() {
        return Err(format!("板块不存在：{sec}"));
    }
    let title = title.trim();
    let base = {
        let b = sanitize_component(if title.is_empty() { "未命名" } else { title });
        if b.is_empty() {
            "未命名".to_string()
        } else {
            b
        }
    };
    let mut candidate = format!("{base}.md");
    let mut n = 2;
    while dir.join(&candidate).exists() {
        candidate = format!("{base}-{n}.md");
        n += 1;
    }
    let escaped = title.replace('"', "'");
    let content = format!("---\ntitle: \"{escaped}\"\n---\n");
    fs::write(dir.join(&candidate), content).map_err(|e| format!("创建失败：{e}"))?;
    Ok(format!("{sec}/{candidate}"))
}

/// 封面上传载荷（前端读取图片文件后转 base64 传入）。
#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoverUpload {
    pub ext: String,
    pub data_base64: String,
}

/// 创建新板块：目录 + _section.md（name/desc）+ 可选封面。返回板块 id（目录名，冲突自动加序号）。
pub fn create_section(
    root: &Path,
    name: &str,
    desc: Option<&str>,
    cover: Option<&CoverUpload>,
) -> Result<String, String> {
    let id = sanitize_component(name);
    if id.is_empty() {
        return Err("板块名称无效".into());
    }
    let mut candidate = id.clone();
    let mut n = 2;
    while root.join(&candidate).exists() {
        candidate = format!("{id}-{n}");
        n += 1;
    }
    // 封面先解码校验，再建目录：避免校验失败留下半成品目录
    let cover_bytes = match cover {
        Some(c) => {
            let ext = save_cover_ext(&c.ext)?;
            let bytes = base64_decode(&c.data_base64)?;
            if bytes.is_empty() {
                return Err("封面文件为空".into());
            }
            if bytes.len() > 12 * 1024 * 1024 {
                return Err("封面图片过大（超过 12MB）".into());
            }
            Some((ext, bytes))
        }
        None => None,
    };
    let dir = root.join(&candidate);
    fs::create_dir(&dir).map_err(|e| format!("创建失败：{e}"))?;
    let escaped = name.replace('"', "'");
    let desc_line = match desc.map(str::trim) {
        Some(d) if !d.is_empty() => format!("\ndesc: \"{}\"", d.replace('"', "'")),
        _ => String::new(),
    };
    let meta = format!("---\nname: \"{escaped}\"{desc_line}\n---\n");
    fs::write(dir.join(SECTION_META_FILE), meta).map_err(|e| format!("创建失败：{e}"))?;
    if let Some((ext, bytes)) = cover_bytes {
        for e in COVER_EXTS {
            let _ = fs::remove_file(dir.join(format!("cover.{e}")));
        }
        fs::write(dir.join(format!("cover.{ext}")), bytes).map_err(|e| format!("{e}"))?;
    }
    Ok(candidate)
}

/// 校验并归一化封面扩展名。
fn save_cover_ext(ext: &str) -> Result<&'static str, String> {
    let e = ext.trim_start_matches('.').to_ascii_lowercase();
    COVER_EXTS
        .iter()
        .find(|x| **x == e)
        .copied()
        .ok_or_else(|| format!("不支持的图片格式：{e}"))
}

/// 按 cover.png → jpg → jpeg → webp → gif 顺序探测板块封面，返回 data URL。
pub fn read_cover(root: &Path, section: &str) -> Option<LogoDto> {
    if section.is_empty() || section.contains("..") {
        return None;
    }
    let ext = cover_file(&root.join(section))?;
    let bytes = fs::read(root.join(section).join(format!("cover.{ext}"))).ok()?;
    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/gif",
    };
    Some(LogoDto {
        data_url: format!("data:{mime};base64,{}", base64_encode(&bytes)),
    })
}

/// 手写 base64 解码（与 base64_encode 对应），忽略空白与 padding。
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    fn rev(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let invalid = || "封面 base64 数据无效".to_string();
    let clean: Vec<u8> = s
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() / 4 * 3 + 3);
    for chunk in clean.chunks(4) {
        if chunk.len() < 2 {
            return Err(invalid());
        }
        let b1 = rev(chunk[0]).ok_or_else(invalid)? as u32;
        let b2 = rev(chunk[1]).ok_or_else(invalid)? as u32;
        let b3 = if chunk.len() > 2 { rev(chunk[2]).ok_or_else(invalid)? as u32 } else { 0 };
        let b4 = if chunk.len() > 3 { rev(chunk[3]).ok_or_else(invalid)? as u32 } else { 0 };
        let n = (b1 << 18) | (b2 << 12) | (b3 << 6) | b4;
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

#[allow(dead_code)]
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 写入错误（序列化为 {kind, ...} 供前端分支处理）。
#[derive(Serialize, Debug, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteError {
    #[error("非法路径")]
    InvalidRel,
    #[error("文件已被外部修改")]
    Conflict { disk: Option<ArticleFileDto> },
    #[error("IO 错误: {0}")]
    Io(String),
}

/// logo 探测结果：data URL（svg 用 utf8，位图用 base64）。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogoDto {
    pub data_url: String,
}

/// 按 logo.svg → png → jpg → jpeg → webp 顺序探测板块 logo。
pub fn read_logo(root: &Path, section: &str) -> Option<LogoDto> {
    if section.is_empty()
        || section.contains('/')
        || section.contains('\\')
        || section.starts_with('.')
        || section.starts_with('_')
    {
        return None;
    }
    let dir = root.join(section);
    let candidates = [
        ("logo.svg", "image/svg+xml", true),
        ("logo.png", "image/png", false),
        ("logo.jpg", "image/jpeg", false),
        ("logo.jpeg", "image/jpeg", false),
        ("logo.webp", "image/webp", false),
    ];
    for (name, mime, utf8) in candidates {
        let p = dir.join(name);
        if let Ok(bytes) = fs::read(&p) {
            let data_url = if utf8 {
                let text = String::from_utf8_lossy(&bytes);
                format!("data:{mime};charset=utf-8,{}", urlencode(&text))
            } else {
                format!("data:{mime};base64,{}", base64_encode(&bytes))
            };
            return Some(LogoDto { data_url });
        }
    }
    None
}

/// data URI 的百分号编码（仅保留 URL 安全字符）。
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// 轻量指纹：所有 md 文件 (mtime 毫秒 + 长度) 的累加，watcher 不可用时的轮询兜底。
/// 跳过 `.`/`_` 开头的目录，统计全部 md（含 `_` 开头），与旧版口径一致。
pub fn scan_fingerprint(root: &Path) -> u64 {
    let mut fp: u64 = 0;
    fn rec(dir: &Path, fp: &mut u64) {
        let Ok(rd) = fs::read_dir(dir) else {
            return;
        };
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                let dir_name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                if dir_name.starts_with('.') || dir_name.starts_with('_') {
                    continue;
                }
                rec(&p, fp);
            } else if p.extension().and_then(|x| x.to_str()) == Some("md") {
                if let Ok(md) = e.metadata() {
                    let t = mtime_ms_of(&md);
                    *fp = fp.wrapping_add(t).wrapping_add(md.len());
                }
            }
        }
    }
    rec(root, &mut fp);
    fp
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_knowledge() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("knowledge")
    }

    #[test]
    fn scans_sections_and_articles() {
        let lib = scan(&repo_knowledge());
        assert_eq!(lib.sections.len(), 17, "应为 17 个板块");
        // 板块按 order 排序，c=10 居首
        assert_eq!(lib.sections.first().unwrap().id, "c");
        // 名称来自 _section.md
        let git = lib.sections.iter().find(|s| s.id == "git").unwrap();
        assert_eq!(git.name, "Git");
        // rust 带子分组
        let basics = lib
            .articles
            .iter()
            .find(|a| a.sec_id == "rust" && a.group.as_deref() == Some("basics"));
        assert!(basics.is_some(), "rust/basics 分组应存在");
        // 根目录文章排在分组前
        let rust_root: Vec<_> = lib.articles.iter().filter(|a| a.sec_id == "rust").collect();
        assert!(rust_root.first().unwrap().group.is_none());
    }

    #[test]
    fn reads_article_with_front_matter() {
        let art = read_article(&repo_knowledge(), "git/01-what-is-git.md").unwrap();
        assert!(art.fm_raw.is_some());
        assert!(!art.title.is_empty());
        assert!(art.body.starts_with('#') || !art.body.trim().is_empty());
        // 正文不再以 --- 定界开头
        assert!(!art.body.trim_start().starts_with("---"));
    }

    #[test]
    fn rejects_unsafe_rel() {
        let root = repo_knowledge();
        assert!(resolve_rel(&root, "../Cargo.toml", false).is_err());
        assert!(resolve_rel(&root, "git/_section.md", false).is_err());
        assert!(resolve_rel(&root, "git/logo.svg", false).is_err());
        assert!(resolve_rel(&root, "C:/x.md", false).is_err());
        assert!(resolve_rel(&root, "git/01-what-is-git.md", false).is_ok());
    }

    #[test]
    fn hex_normalization() {
        assert_eq!(normalize_hex("#D97706").unwrap(), "#d97706");
        assert_eq!(normalize_hex("#abc").unwrap(), "#aabbcc");
        assert!(normalize_hex("red").is_none());
    }
}

/// 保存粘贴/插入的图片到板块 `images/` 目录，返回库内相对路径。
pub fn save_paste_image(
    root: &Path,
    sec_id: &str,
    file_name: &str,
    data_base64: &str,
) -> Result<String, String> {
    let invalid = |m: String| format!("图片保存失败：{m}");
    if sec_id.is_empty() || sec_id.contains("..") || sec_id.contains('/') || sec_id.contains('\\')
    {
        return Err(invalid("板块路径非法".into()));
    }
    let bytes = base64_decode(data_base64).map_err(invalid)?;
    if bytes.is_empty() {
        return Err(invalid("图片数据为空".into()));
    }
    if bytes.len() > 12 * 1024 * 1024 {
        return Err(invalid("图片过大（超过 12MB）".into()));
    }
    let path = Path::new(file_name);
    let ext = path
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| x.to_ascii_lowercase())
        .unwrap_or_else(|| "png".into());
    if !matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "bmp"
    ) {
        return Err(invalid(format!("不支持的图片格式：{ext}")));
    }
    let stem = path
        .file_stem()
        .and_then(|x| x.to_str())
        .map(sanitize_component)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "image".into());
    let stem: String = stem.chars().take(40).collect();
    let images_dir = root.join(sec_id).join("images");
    fs::create_dir_all(&images_dir).map_err(|e| invalid(e.to_string()))?;
    let name = format!("{stem}-{}.{ext}", now_ms());
    let rel = format!("{sec_id}/images/{name}");
    fs::write(root.join(&rel), bytes).map_err(|e| invalid(e.to_string()))?;
    Ok(rel)
}

/// 运行用户配置的图片上传命令（Typora 习惯：图片临时路径作为最后一个参数追加），
/// 返回 stdout 中解析到的第一个 http(s) 链接。
pub fn run_upload_cmd(command: &str, ext: &str, data_base64: &str) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("上传命令为空".into());
    }
    let bytes = base64_decode(data_base64).map_err(|e| format!("上传失败：{e}"))?;
    if bytes.is_empty() {
        return Err("上传失败：图片数据为空".into());
    }
    let temp = std::env::temp_dir().join(format!("kv-upload-{}.{ext}", now_ms()));
    fs::write(&temp, &bytes).map_err(|e| format!("上传失败：{e}"))?;
    let spawn = crate::upload_command::image_upload_command(command, &temp)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();
    let mut child = spawn.map_err(|e| format!("上传失败：无法执行命令（{e}）"))?;
    let start = std::time::Instant::now();
    let output = loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                break child
                    .wait_with_output()
                    .map_err(|e| format!("上传失败：{e}"))?
            }
            Ok(None) => {
                if start.elapsed() > std::time::Duration::from_secs(30) {
                    let _ = child.kill();
                    let _ = fs::remove_file(&temp);
                    return Err("上传失败：命令超时（30 秒）".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("上传失败：{e}")),
        }
    };
    let _ = fs::remove_file(&temp);
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines().rev() {
        if let Some(i) = line.find("http://").or_else(|| line.find("https://")) {
            let rest = &line[i..];
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                .unwrap_or(rest.len());
            let url = &rest[..end];
            if url.len() > 8 {
                return Ok(url.to_string());
            }
        }
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "上传失败：命令未返回图片链接{}",
        if stderr.trim().is_empty() {
            String::new()
        } else {
            format!("（{}）", stderr.trim())
        }
    ))
}

/// 读取库内相对路径的图片，返回 data URL（编辑器内显示相对路径图片用）。
pub fn read_image(root: &Path, rel: &str) -> Option<LogoDto> {
    if rel.is_empty() || rel.contains("..") || rel.starts_with('/') {
        return None;
    }
    let p = root.join(rel);
    let ext = p
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| x.to_ascii_lowercase())?;
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    };
    let bytes = fs::read(p).ok()?;
    Some(LogoDto {
        data_url: format!("data:{mime};base64,{}", base64_encode(&bytes)),
    })
}
