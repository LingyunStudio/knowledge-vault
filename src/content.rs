//! 知识库内容层：扫描 `knowledge/` 目录、解析 front matter、提供板块/文章模型。

use std::fs;
use std::path::{Path, PathBuf};

use crate::theme::{self, SectionMeta};

#[derive(Clone, Debug)]
pub struct Article {
    /// 相对 knowledge 根目录的路径，如 `rust/04-ownership.md`。
    pub rel: String,
    #[allow(dead_code)]
    pub file_name: String,
    pub title: String,
    pub summary: String,
    pub order: i32,
    pub tags: Vec<String>,
    pub mtime: std::time::SystemTime,
    /// 正文（去掉 front matter），用于渲染。
    pub body: String,
    /// 纯文本版正文（剥离 Markdown 语法），用于全文搜索与摘要。
    pub plain: String,
}

pub struct Section {
    pub meta: SectionMeta,
    pub articles: Vec<Article>,
}

impl Section {
    pub fn is_empty(&self) -> bool {
        self.articles.is_empty()
    }
}

pub struct Library {
    pub sections: Vec<Section>,
    /// 全部文件 mtime+len 的简单指纹，用于检测内容变化实现自动重载。
    pub fingerprint: u64,
}

impl Library {
    pub fn load(root: &Path) -> Library {
        let mut sections = Vec::new();
        let mut fingerprint: u64 = 0;

        let mut dir_ids: Vec<String> = fs::read_dir(root)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();
        // 已知板块按固定顺序在前，未知目录按名称排在后面
        dir_ids.sort();
        let known: Vec<&str> = theme::SECTIONS.iter().map(|s| s.id).collect();
        dir_ids
            .sort_by_key(|id| known.iter().position(|k| *k == id.as_str()).unwrap_or(known.len()));

        for id in &dir_ids {
            let meta = theme::SECTIONS
                .iter()
                .find(|s| s.id == id)
                .map(|s| SectionMeta {
                    id: s.id,
                    name: s.name,
                    glyph: s.glyph,
                    desc: s.desc,
                    accent: s.accent,
                })
                .unwrap_or_else(|| fallback_meta_for(id));
            let mut articles = Vec::new();
            let sec_dir = root.join(id);
            if let Ok(rd) = fs::read_dir(&sec_dir) {
                for e in rd.filter_map(|e| e.ok()) {
                    let p = e.path();
                    if p.extension().and_then(|x| x.to_str()) != Some("md") {
                        continue;
                    }
                    let name = p.file_name().unwrap().to_string_lossy().to_string();
                    if name.starts_with('_') {
                        continue; // _开头视为草稿/内部文件
                    }
                    let Ok(text) = fs::read_to_string(&p) else { continue };
                    let mtime = e
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    fingerprint = fingerprint
                        .wrapping_add(e.metadata().map(|m| m.len()).unwrap_or(0))
                        .wrapping_add(
                            mtime.duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_nanos() as u64)
                                .unwrap_or(0),
                        );
                    let (fm, body) = parse_front_matter(&text);
                    let plain = strip_markdown(&body);
                    articles.push(Article {
                        rel: format!("{id}/{name}"),
                        file_name: name,
                        title: fm.title.unwrap_or_else(|| {
                            p.file_stem().unwrap().to_string_lossy().to_string()
                        }),
                        summary: fm.summary,
                        order: fm.order,
                        tags: fm.tags,
                        mtime,
                        body,
                        plain,
                    });
                }
            }
            articles.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.title.cmp(&b.title)));
            sections.push(Section { meta, articles });
        }

        Library { sections, fingerprint }
    }

    pub fn section(&self, id: &str) -> Option<&Section> {
        self.sections.iter().find(|s| s.meta.id == id)
    }

    pub fn article(&self, rel: &str) -> Option<&Article> {
        self.sections
            .iter()
            .flat_map(|s| &s.articles)
            .find(|a| a.rel == rel)
    }

    pub fn section_of(&self, rel: &str) -> Option<&Section> {
        let id = rel.split('/').next()?;
        self.section(id)
    }

    /// (有内容的板块数, 文章总数)
    pub fn stats(&self) -> (usize, usize) {
        let n = self
            .sections
            .iter()
            .filter(|s| !s.is_empty())
            .count();
        (n, self.sections.iter().map(|s| s.articles.len()).sum())
    }

    pub fn all_articles(&self) -> impl Iterator<Item = (&Section, &Article)> {
        self.sections
            .iter()
            .filter(|s| !s.is_empty())
            .flat_map(|s| s.articles.iter().map(move |a| (s, a)))
    }
}

fn fallback_meta_for(id: &str) -> SectionMeta {
    let mut name = id.to_string();
    if let Some(c) = name.get_mut(0..1) {
        c.make_ascii_uppercase();
    }
    let glyph: String = id.chars().take(2).collect();
    theme::SectionMeta {
        id: Box::leak(id.to_string().into_boxed_str()),
        name: Box::leak(name.into_boxed_str()),
        glyph: Box::leak(glyph.into_boxed_str()),
        desc: Box::leak(String::new().into_boxed_str()),
        accent: egui::Color32::from_rgb(0x8B, 0x93, 0xF8),
    }
}

#[derive(Default)]
struct FrontMatter {
    title: Option<String>,
    order: i32,
    tags: Vec<String>,
    summary: String,
}

/// 解析 `--- ... ---` 包裹的简易 front matter。
fn parse_front_matter(text: &str) -> (FrontMatter, String) {
    let mut fm = FrontMatter::default();
    let t = text.trim_start_matches('\u{feff}').trim_start();
    if !t.starts_with("---") {
        return (fm, t.to_string());
    }
    let Some(end) = t[3..].find("\n---") else {
        return (fm, t.to_string());
    };
    let header = &t[3..3 + end];
    let body = t[3 + end + 4..]
        .trim_start_matches('\r')
        .trim_start_matches('\n');
    for line in header.lines() {
        let Some((k, v)) = line.split_once(':') else { continue };
        let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
        match k.trim() {
            "title" => fm.title = Some(v),
            "order" => fm.order = v.parse().unwrap_or(999),
            "summary" | "description" => fm.summary = v,
            "tags" | "keywords" => {
                fm.tags = v
                    .split(|c: char| c == ',' || c == '，' || c == '、')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            _ => {}
        }
    }
    (fm, body.to_string())
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
    out.replace("**", "")
        .replace("__", "")
        .replace("~~", "")
        .replace('`', "")
        .replace("](", " ")
        .replace('[', "")
}

/// 轻量指纹：所有 md 文件 (mtime 纳秒 + 长度) 的累加，用于自动重载检测。
pub fn scan_fingerprint(root: &Path) -> u64 {
    let mut fp: u64 = 0;
    fn rec(dir: &Path, fp: &mut u64) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                rec(&p, fp);
            } else if p.extension().and_then(|x| x.to_str()) == Some("md") {
                if let Ok(md) = e.metadata() {
                    let t = md
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_nanos() as u64)
                        .unwrap_or(0);
                    *fp = fp.wrapping_add(t).wrapping_add(md.len());
                }
            }
        }
    }
    rec(root, &mut fp);
    fp
}

/// 递归列出目录下所有文件的 (路径, mtime, len)，用于指纹。
#[allow(dead_code)]
fn walk(root: &Path, out: &mut Vec<(PathBuf, std::time::SystemTime, u64)>) {
    let Ok(rd) = fs::read_dir(root) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if let Ok(md) = e.metadata() {
            out.push((
                p,
                md.modified().unwrap_or(std::time::UNIX_EPOCH),
                md.len(),
            ));
        }
    }
}
