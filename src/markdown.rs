//! Markdown → 自定义文档 AST。
//!
//! 先用 pulldown-cmark 把源文本展平为事件流，再按指针递归重建嵌套结构。
//! 输出的 AST 与 egui 解耦，渲染层只关心 Block/Inline。

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

#[derive(Clone, Debug)]
pub enum Inline {
    Text(String),
    /// 软换行：渲染时按 CJK 上下文决定空格或忽略。
    Soft,
    Hard,
    Emph(Vec<Inline>),
    Strong(Vec<Inline>),
    Strike(Vec<Inline>),
    Code(String),
    Link(Vec<Inline>, String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalloutKind {
    Note,
    Tip,
    Important,
    Warning,
    Danger,
}

impl CalloutKind {
    pub fn index(self) -> usize {
        match self {
            CalloutKind::Note => 0,
            CalloutKind::Tip => 1,
            CalloutKind::Important => 2,
            CalloutKind::Warning => 3,
            CalloutKind::Danger => 4,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Item {
    /// `Some(true/false)` 表示任务列表项及其勾选状态。
    pub task: Option<bool>,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Debug)]
pub enum Block {
    Heading(u8, Vec<Inline>),
    Para(Vec<Inline>),
    Code { lang: String, code: String },
    Quote(Option<CalloutKind>, Vec<Block>),
    List { ordered: bool, start: u64, items: Vec<Item> },
    Table {
        head: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Rule,
    Image { src: String, alt: Vec<Inline> },
    Footnote(String, Vec<Block>),
}

#[derive(Clone, Debug)]
pub struct Doc {
    pub blocks: Vec<Block>,
    /// (级别, 纯文本)，与渲染顺序一致，用于 TOC。
    pub headings: Vec<(u8, String)>,
}

pub fn parse(text: &str) -> Doc {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_FOOTNOTES);
    let events: Vec<Event> = Parser::new_ext(text, opts).collect();
    let mut i = 0usize;
    let blocks = parse_blocks(&events, &mut i);
    let mut headings = Vec::new();
    for b in &blocks {
        collect_headings(b, &mut headings);
    }
    Doc { blocks, headings }
}

fn collect_headings(b: &Block, out: &mut Vec<(u8, String)>) {
    match b {
        Block::Heading(l, inl) => out.push((*l, inlines_plain(inl))),
        Block::Quote(_, inner) | Block::Footnote(_, inner) => {
            for b in inner {
                collect_headings(b, out);
            }
        }
        Block::List { items, .. } => {
            for it in items {
                for b in &it.blocks {
                    collect_headings(b, out);
                }
            }
        }
        _ => {}
    }
}

fn inlines_plain(inl: &[Inline]) -> String {
    let mut s = String::new();
    for i in inl {
        match i {
            Inline::Text(t) => s.push_str(t),
            Inline::Soft | Inline::Hard => s.push(' '),
            Inline::Emph(v) | Inline::Strong(v) | Inline::Strike(v) | Inline::Link(v, _) => {
                s.push_str(&inlines_plain(v))
            }
            Inline::Code(c) => s.push_str(c),
        }
    }
    s.trim().to_string()
}

/// 供渲染层取图片 alt 文本。
pub fn plain_of(inl: &[Inline]) -> String {
    inlines_plain(inl)
}

/// 解析到遇到容器 End 为止（不消费该 End），供上层消费。
fn parse_blocks(ev: &[Event], i: &mut usize) -> Vec<Block> {
    let mut out = Vec::new();
    while *i < ev.len() {
        match &ev[*i] {
            Event::Start(Tag::Paragraph) => {
                *i += 1;
                let inl = parse_inlines(ev, i, TagEnd::Paragraph);
                out.push(Block::Para(inl));
            }
            Event::Start(Tag::Heading { level, .. }) => {
                let l = *level as u8;
                *i += 1;
                let inl = parse_inlines(ev, i, TagEnd::Heading(*level));
                out.push(Block::Heading(l, inl));
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                let lang = match kind {
                    CodeBlockKind::Fenced(l) => l.split(',').next().unwrap_or("").trim().to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                *i += 1;
                let mut code = String::new();
                while *i < ev.len() {
                    match &ev[*i] {
                        Event::Text(t) => {
                            code.push_str(t);
                            *i += 1;
                        }
                        Event::End(TagEnd::CodeBlock) => {
                            *i += 1;
                            break;
                        }
                        _ => *i += 1,
                    }
                }
                out.push(Block::Code { lang, code });
            }
            Event::Start(Tag::BlockQuote(_)) => {
                *i += 1;
                let inner = parse_blocks(ev, i); // 停在 End(BlockQuote)
                *i += 1; // 消费 End
                let mut callout = None;
                let mut inner = inner;
                if let Some(Block::Para(first)) = inner.first() {
                    if let Some(Inline::Text(t)) = first.first() {
                        if let Some(rest) = t.strip_prefix("[!") {
                            if let Some((kind, _)) =
                                rest.split_once(']')
                            {
                                let k = match kind {
                                    "NOTE" => Some(CalloutKind::Note),
                                    "TIP" => Some(CalloutKind::Tip),
                                    "IMPORTANT" => Some(CalloutKind::Important),
                                    "WARNING" => Some(CalloutKind::Warning),
                                    "CAUTION" | "DANGER" => Some(CalloutKind::Danger),
                                    _ => None,
                                };
                                if let Some(k) = k {
                                    callout = Some(k);
                                    let mut p = first.clone();
                                    // 去掉标记与其后的空格
                                    let consumed = 2 + kind.len() + 1;
                                    let lead: String =
                                        t[consumed..].trim_start_matches(' ').to_string();
                                    if lead.is_empty() {
                                        p.remove(0);
                                    } else {
                                        p[0] = Inline::Text(lead);
                                    }
                                    if p.is_empty() {
                                        inner.remove(0);
                                    } else {
                                        inner[0] = Block::Para(p);
                                    }
                                }
                            }
                        }
                    }
                }
                out.push(Block::Quote(callout, inner));
            }
            Event::Start(Tag::List(start)) => {
                let (ordered, start_n) = (start.is_some(), start.unwrap_or(1));
                *i += 1;
                let mut items = Vec::new();
                while *i < ev.len() {
                    match &ev[*i] {
                        Event::Start(Tag::Item) => {
                            *i += 1;
                            let mut task = None;
                            if let Some(Event::TaskListMarker(done)) = ev.get(*i) {
                                task = Some(*done);
                                *i += 1;
                            }
                            let blocks = parse_blocks(ev, i); // 停在 End(Item)
                            *i += 1; // 消费 End(Item)
                            items.push(Item { task, blocks });
                        }
                        Event::End(TagEnd::List(_)) => {
                            *i += 1;
                            break;
                        }
                        _ => *i += 1,
                    }
                }
                out.push(Block::List { ordered, start: start_n, items });
            }
            Event::Start(Tag::Table(_)) => {
                *i += 1;
                let mut head = Vec::new();
                let mut rows = Vec::new();
                while *i < ev.len() {
                    match &ev[*i] {
                        Event::Start(Tag::TableHead) => {
                            *i += 1;
                            head = parse_table_cells(ev, i, TagEnd::TableHead);
                        }
                        Event::Start(Tag::TableRow) => {
                            *i += 1;
                            rows.push(parse_table_cells(ev, i, TagEnd::TableRow));
                        }
                        Event::End(TagEnd::Table) => {
                            *i += 1;
                            break;
                        }
                        _ => *i += 1,
                    }
                }
                out.push(Block::Table { head, rows });
            }
            Event::Rule => {
                *i += 1;
                out.push(Block::Rule);
            }
            Event::Start(Tag::Image { dest_url, .. }) => {
                let url = dest_url.to_string();
                *i += 1;
                let alt = parse_inlines(ev, i, TagEnd::Image);
                out.push(Block::Image { src: url, alt });
            }
            Event::Start(Tag::FootnoteDefinition(label)) => {
                let l = label.to_string();
                *i += 1;
                let blocks = parse_blocks(ev, i);
                *i += 1;
                out.push(Block::Footnote(l, blocks));
            }
            Event::End(_) => break, // 容器结束，交还上层
            _ => *i += 1,
        }
    }
    out
}

fn parse_table_cells(ev: &[Event], i: &mut usize, end: TagEnd) -> Vec<Vec<Inline>> {
    let mut cells = Vec::new();
    while *i < ev.len() {
        match &ev[*i] {
            Event::Start(Tag::TableCell) => {
                *i += 1;
                cells.push(parse_inlines(ev, i, TagEnd::TableCell));
            }
            Event::End(e) if *e == end => {
                *i += 1;
                break;
            }
            _ => *i += 1,
        }
    }
    cells
}

/// 收集行内元素直到遇到匹配的 End（消费之）。
fn parse_inlines(ev: &[Event], i: &mut usize, end: TagEnd) -> Vec<Inline> {
    let mut out = Vec::new();
    while *i < ev.len() {
        match &ev[*i] {
            Event::End(e) if *e == end => {
                *i += 1;
                break;
            }
            Event::Text(t) => {
                out.push(Inline::Text(t.to_string()));
                *i += 1;
            }
            Event::Code(t) => {
                out.push(Inline::Code(t.to_string()));
                *i += 1;
            }
            Event::SoftBreak => {
                out.push(Inline::Soft);
                *i += 1;
            }
            Event::HardBreak => {
                out.push(Inline::Hard);
                *i += 1;
            }
            Event::Start(Tag::Emphasis) => {
                *i += 1;
                let v = parse_inlines(ev, i, TagEnd::Emphasis);
                out.push(Inline::Emph(v));
            }
            Event::Start(Tag::Strong) => {
                *i += 1;
                let v = parse_inlines(ev, i, TagEnd::Strong);
                out.push(Inline::Strong(v));
            }
            Event::Start(Tag::Strikethrough) => {
                *i += 1;
                let v = parse_inlines(ev, i, TagEnd::Strikethrough);
                out.push(Inline::Strike(v));
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                let url = dest_url.to_string();
                *i += 1;
                let v = parse_inlines(ev, i, TagEnd::Link);
                out.push(Inline::Link(v, url));
            }
            Event::Start(Tag::Image { dest_url, .. }) => {
                let url = dest_url.to_string();
                *i += 1;
                let alt = parse_inlines(ev, i, TagEnd::Image);
                out.push(Inline::Link(alt, url)); // 行内图片退化为链接
            }
            _ => *i += 1,
        }
    }
    out
}
