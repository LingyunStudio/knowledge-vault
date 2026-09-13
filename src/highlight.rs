//! syntect 语法高亮 → 每行彩色文本段，供代码块渲染。
//!
//! 代码块恒定使用深色主题，与应用深浅模式无关，保证对比度一致。

use std::hash::{Hash, Hasher};

use egui::Color32;
use syntect::easy::HighlightLines;
use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::SyntaxSet;

pub type Span = (Color32, String);
pub type Line = Vec<Span>;

pub struct Highlighter {
    ps: SyntaxSet,
    themes: ThemeSet,
}

impl Highlighter {
    pub fn new() -> Self {
        Self {
            ps: SyntaxSet::load_defaults_newlines(),
            themes: ThemeSet::load_defaults(),
        }
    }

    fn theme(&self) -> &Theme {
        &self.themes.themes["base16-ocean.dark"]
    }

    /// 把一段代码高亮为若干行、每行若干彩色片段。
    pub fn highlight(&self, lang: &str, code: &str) -> Vec<Line> {
        let syntax = self
            .ps
            .find_syntax_by_token(lang)
            .unwrap_or_else(|| self.ps.find_syntax_plain_text());
        let mut hl = HighlightLines::new(syntax, self.theme());
        let mut lines: Vec<Line> = Vec::new();

        let code_norm = code.trim_end_matches('\n');
        if code_norm.is_empty() {
            return vec![vec![(Color32::GRAY, String::new())]];
        }
        for line in syntect::util::LinesWithEndings::from(code_norm) {
            let regions = hl.highlight_line(line, &self.ps).unwrap_or_default();
            let mut cur: Line = Vec::new();
            for (style, text) in regions {
                // 去掉行尾换行，逐行渲染
                let t = text.trim_end_matches('\n').trim_end_matches('\r');
                if t.is_empty() {
                    continue;
                }
                let c = Color32::from_rgb(
                    style.foreground.r,
                    style.foreground.g,
                    style.foreground.b,
                );
                match cur.last_mut() {
                    Some((c0, s)) if *c0 == c => s.push_str(t),
                    _ => cur.push((c, t.to_string())),
                }
            }
            if cur.is_empty() {
                cur.push((Color32::GRAY, String::new()));
            }
            lines.push(cur);
        }
        lines
    }

    pub fn code_hash(lang: &str, code: &str) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        lang.hash(&mut h);
        code.hash(&mut h);
        h.finish()
    }
}
