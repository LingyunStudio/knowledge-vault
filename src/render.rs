//! AST → egui 绘制：排版、代码高亮块、表格、callout、链接交互。

use std::collections::HashMap;
use std::ops::Range;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use egui::{
    Align, Color32, CornerRadius, CursorIcon, FontFamily, FontId, Frame, Layout, Margin, Pos2,
    Rect, Sense, Stroke, TextFormat, Ui, Vec2,
};

use crate::highlight::{Highlighter, Line};
use crate::markdown::{Block, CalloutKind, Doc, Inline};
use crate::theme::{tint_over, Palette, CALLOUT_NAMES};

pub enum Action {
    OpenArticle(String),
    OpenUrl(String),
}

pub struct Env<'a> {
    pub pal: &'a Palette,
    pub accent: Color32,
    pub scale: f32,
    /// knowledge 根目录
    pub root: PathBuf,
    /// 当前文章所在目录，用于解析相对图片/内链
    pub base_dir: PathBuf,
}

pub struct Out {
    pub actions: Vec<Action>,
    pub heading_y: Vec<f32>,
}

pub struct Renderer<'a> {
    pub env: Env<'a>,
    pub hl: &'a Highlighter,
    pub code_cache: &'a mut HashMap<u64, Vec<Line>>,
    pub copied: &'a mut HashMap<u64, Instant>,
    pub out: Out,
}

#[derive(Clone)]
struct BaseFmt {
    size: f32,
    fam: FontFamily,
    color: Color32,
    bold: bool,
    italic: bool,
}

struct JobBuilder {
    job: egui::text::LayoutJob,
    links: Vec<(Range<usize>, String)>,
    chars: usize,
    pending_soft: bool,
    last_char: Option<char>,
}

impl JobBuilder {
    fn new() -> Self {
        Self {
            job: egui::text::LayoutJob::default(),
            links: Vec::new(),
            chars: 0,
            pending_soft: false,
            last_char: None,
        }
    }

    fn push(&mut self, text: &str, fmt: TextFormat) {
        if text.is_empty() {
            return;
        }
        if self.pending_soft {
            if needs_space(self.last_char, text.chars().next()) {
                self.push_raw(" ", fmt.clone());
            }
            self.pending_soft = false;
        }
        self.push_raw(text, fmt);
    }

    fn push_raw(&mut self, text: &str, fmt: TextFormat) {
        self.chars += text.chars().count();
        self.last_char = text.chars().last().or(self.last_char);
        self.job.append(text, 0.0, fmt);
    }
}

fn is_cjk(c: char) -> bool {
    let u = c as u32;
    (0x2E80..=0x9FFF).contains(&u) || (0xFF00..=0xFFEF).contains(&u) || (0x3000..=0x303F).contains(&u)
}

fn needs_space(prev: Option<char>, next: Option<char>) -> bool {
    let (Some(a), Some(b)) = (prev, next) else { return false };
    !(is_cjk(a) || is_cjk(b))
}

impl<'a> Renderer<'a> {
    fn fmt(&self, bf: &BaseFmt, color: Color32) -> TextFormat {
        let size = bf.size * self.env.scale;
        TextFormat {
            font_id: FontId::new(size, bf.fam.clone()),
            color,
            line_height: Some((size * 1.62).round()),
            italics: bf.italic,
            valign: Align::Center,
            ..Default::default()
        }
    }

    fn inline_fmt(&self, bf: &BaseFmt, color: Color32) -> TextFormat {
        let mut f = self.fmt(bf, color);
        if bf.bold {
            f.font_id = FontId::new(bf.size * self.env.scale, crate::theme::main_bold());
        }
        if bf.italic {
            f.font_id = FontId::new(bf.size * self.env.scale, crate::theme::main_italic());
            f.italics = true;
        }
        f
    }

    pub fn render_doc(ui: &mut Ui, doc: &Doc, env: Env<'a>, hl: &'a Highlighter,
        code_cache: &'a mut HashMap<u64, Vec<Line>>, copied: &'a mut HashMap<u64, Instant>,
    ) -> Out {
        let mut r = Renderer {
            env,
            hl,
            code_cache,
            copied,
            out: Out { actions: Vec::new(), heading_y: Vec::new() },
        };
        r.blocks(ui, &doc.blocks, false);
        let Renderer { out, .. } = r;
        out
    }

    fn blocks(&mut self, ui: &mut Ui, blocks: &[Block], tight: bool) {
        for (i, b) in blocks.iter().enumerate() {
            if i > 0 {
                ui.add_space(if tight { 3.0 } else { 6.0 });
            }
            match b {
                Block::Heading(l, inl) => self.heading(ui, *l, inl),
                Block::Para(inl) => self.paragraph(ui, inl, tight),
                Block::Code { lang, code } => self.code_block(ui, lang, code),
                Block::Quote(kind, inner) => self.quote(ui, *kind, inner),
                Block::List { ordered, start, items } => self.list(ui, *ordered, *start, items),
                Block::Table { head, rows } => self.table(ui, head, rows),
                Block::Rule => self.rule(ui),
                Block::Image { src, alt } => self.image(ui, src, alt),
                Block::Footnote(label, inner) => self.footnote(ui, label, inner),
            }
        }
    }

    // ---------------- 行内文本 ----------------

    fn build_job(&mut self, inl: &[Inline], bf: &BaseFmt) -> JobBuilder {
        let mut jb = JobBuilder::new();
        self.push_inlines(&mut jb, inl, bf);
        jb
    }

    fn push_inlines(&mut self, jb: &mut JobBuilder, inl: &[Inline], bf: &BaseFmt) {
        for i in inl {
            match i {
                Inline::Text(t) => {
                    let f = self.inline_fmt(bf, bf.color);
                    jb.push(t, f);
                }
                Inline::Soft => jb.pending_soft = true,
                Inline::Hard => {
                    let f = self.inline_fmt(bf, bf.color);
                    jb.push_raw("\n", f);
                    jb.last_char = None;
                }
                Inline::Code(c) => {
                    let mut b2 = bf.clone();
                    b2.size = bf.size * 0.88;
                    b2.fam = crate::theme::mono_family();
                    let bg = self.env.pal.code_bg; // 行内代码用统一深底
                    let color = Color32::from_rgb(0xE8, 0x96, 0x72);
                    let f = self.fmt(&b2, color);
                    let mut f = f;
                    f.background = bg;
                    jb.pending_soft = false;
                    jb.push(c, f);
                }
                Inline::Emph(v) => {
                    let mut b2 = bf.clone();
                    b2.italic = true;
                    self.push_inlines(jb, v, &b2);
                }
                Inline::Strong(v) => {
                    let mut b2 = bf.clone();
                    b2.bold = true;
                    self.push_inlines(jb, v, &b2);
                }
                Inline::Strike(v) => {
                    self.push_strike(jb, v, bf);
                }
                Inline::Link(v, url) => {
                    let start = jb.chars;
                    let mut b2 = bf.clone();
                    b2.color = self.env.accent;
                    self.push_inlines(jb, v, &b2);
                    jb.links.push((start..jb.chars, url.clone()));
                }
            }
        }
    }

    /// 删除线需要作用于 TextFormat，这里单独处理 Strike 的子树。
    fn push_strike(&mut self, jb: &mut JobBuilder, inl: &[Inline], bf: &BaseFmt) {
        for i in inl {
            match i {
                Inline::Text(t) => {
                    let mut f = self.inline_fmt(bf, bf.color);
                    f.strikethrough = Stroke::new(1.0, bf.color);
                    jb.push(t, f);
                }
                Inline::Code(c) => {
                    let mut b2 = bf.clone();
                    b2.size = bf.size * 0.88;
                    b2.fam = crate::theme::mono_family();
                    let mut f = self.fmt(&b2, Color32::from_rgb(0xE8, 0x96, 0x72));
                    f.background = self.env.pal.code_bg;
                    f.strikethrough = Stroke::new(1.0, Color32::from_rgb(0xE8, 0x96, 0x72));
                    jb.pending_soft = false;
                    jb.push(c, f);
                }
                Inline::Soft => jb.pending_soft = true,
                Inline::Hard => {
                    let mut f = self.inline_fmt(bf, bf.color);
                    f.strikethrough = Stroke::new(1.0, bf.color);
                    jb.push_raw("\n", f);
                    jb.last_char = None;
                }
                Inline::Emph(v) | Inline::Strong(v) | Inline::Strike(v) | Inline::Link(v, _) => {
                    self.push_strike(jb, v, bf)
                }
            }
        }
    }

    // ---------------- 块级元素 ----------------

    fn paragraph(&mut self, ui: &mut Ui, inl: &[Inline], tight: bool) {
        let avail = ui.available_width();
        let bf = BaseFmt {
            size: 15.5,
            fam: crate::theme::main_family(),
            color: self.env.pal.text,
            bold: false,
            italic: false,
        };
        let mut jb = self.build_job(inl, &bf);
        jb.job.wrap.max_width = avail;
        let galley = ui.painter().layout_job(std::mem::take(&mut jb.job));
        let h = galley.size().y.max(20.0 * self.env.scale);
        let (rect, resp) = ui.allocate_exact_size(Vec2::new(avail, h), Sense::CLICK | Sense::HOVER);
        ui.painter().galley(rect.min, galley.clone(), self.env.pal.text);
        self.handle_links(ui, &resp, rect.min, &galley, &jb.links);
        if !tight {
            // 段落之间的留白交给 blocks() 的 add_space
        }
    }

    fn handle_links(
        &mut self,
        ui: &mut Ui,
        resp: &egui::Response,
        galley_pos: Pos2,
        galley: &egui::text::Galley,
        links: &[(Range<usize>, String)],
    ) {
        if links.is_empty() {
            return;
        }
        let Some(p) = resp.hover_pos() else { return };
        if !resp.hovered() && !resp.clicked() {
            return;
        }
        for (rect, url) in link_rects(galley, galley_pos, links) {
            if rect.contains(p) {
                ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
                ui.painter().rect_filled(
                    rect.expand2(Vec2::new(1.0, 0.0)),
                    CornerRadius::same(2),
                    tint_over(self.env.accent, self.env.pal.bg, 0.14),
                );
                if resp.clicked() {
                    self.open_link(&url);
                }
            }
        }
    }

    fn open_link(&mut self, url: &str) {
        if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:") {
            self.out.actions.push(Action::OpenUrl(url.to_string()));
            return;
        }
        if url.ends_with(".md") {
            let target = norm_path(&self.env.base_dir.join(url));
            let root = norm_path(&self.env.root);
            if let Ok(rel) = target.strip_prefix(&root) {
                let rel = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join("/");
                self.out.actions.push(Action::OpenArticle(rel));
            }
        }
    }

    fn heading(&mut self, ui: &mut Ui, level: u8, inl: &[Inline]) {
        let pal = self.env.pal;
        let y = ui.cursor().top();
        let bf = |size: f32, bold: bool| BaseFmt {
            size,
            fam: crate::theme::main_family(),
            color: pal.text,
            bold,
            italic: false,
        };
        match level {
            1 | 2 => {
                ui.add_space(if level == 1 { 12.0 } else { 14.0 });
                ui.horizontal(|ui| {
                    let bar_h = 21.0 * self.env.scale;
                    let (r, _) =
                        ui.allocate_exact_size(Vec2::new(4.0, bar_h), Sense::hover());
                    ui.painter()
                        .rect_filled(r, CornerRadius::same(2), self.env.accent);
                    let mut jb = self.build_job(inl, &bf(21.0, true));
                    jb.job.wrap.max_width = ui.available_width();
                    let galley = ui.painter().layout_job(std::mem::take(&mut jb.job));
                    let (r2, resp) = ui.allocate_exact_size(
                        Vec2::new(ui.available_width(), galley.size().y.max(bar_h)),
                        Sense::CLICK | Sense::HOVER,
                    );
                    ui.painter().galley(
                        Pos2::new(r2.min.x, r2.center().y - galley.size().y / 2.0),
                        galley.clone(),
                        pal.text,
                    );
                    self.handle_links(ui, &resp, r2.min, &galley, &jb.links);
                });
                ui.add_space(2.0);
            }
            3 => {
                ui.add_space(10.0);
                let mut jb = self.build_job(inl, &bf(17.0, true));
                jb.job.wrap.max_width = ui.available_width();
                let galley = ui.painter().layout_job(std::mem::take(&mut jb.job));
                let (rect, resp) =
                    ui.allocate_exact_size(Vec2::new(ui.available_width(), galley.size().y), Sense::CLICK | Sense::HOVER);
                ui.painter().galley(rect.min, galley.clone(), pal.text);
                self.handle_links(ui, &resp, rect.min, &galley, &jb.links);
            }
            _ => {
                ui.add_space(8.0);
                let mut jb = self.build_job(inl, &bf(15.5, true));
                jb.job.wrap.max_width = ui.available_width();
                let galley = ui.painter().layout_job(std::mem::take(&mut jb.job));
                let (rect, resp) =
                    ui.allocate_exact_size(Vec2::new(ui.available_width(), galley.size().y), Sense::CLICK | Sense::HOVER);
                ui.painter().galley(rect.min, galley.clone(), pal.text_dim);
                self.handle_links(ui, &resp, rect.min, &galley, &jb.links);
            }
        }
        self.out.heading_y.push(y);
    }

    fn code_block(&mut self, ui: &mut Ui, lang: &str, code: &str) {
        let pal = self.env.pal;
        let hash = Highlighter::code_hash(lang, code);
        let lines: Vec<Line> = {
            let hl = self.hl;
            self.code_cache
                .entry(hash)
                .or_insert_with(|| hl.highlight(lang, code))
                .clone()
        };
        let copied_just = self
            .copied
            .get(&hash)
            .map(|t| t.elapsed().as_secs_f32() < 1.6)
            .unwrap_or(false);

        let lang_disp = if lang.is_empty() { "text" } else { lang };
        let lang_disp = lang_disp.to_uppercase();

        let code_owned = code.to_string();
        let body_w = ui.available_width();

        Frame::new()
            .fill(pal.code_bg)
            .stroke(Stroke::new(1.0, pal.code_border))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(Margin::ZERO)
            .show(ui, |ui| {
                // ---- 头部：语言标签 + 复制按钮 ----
                ui.allocate_ui_with_layout(
                    Vec2::new(body_w, 30.0),
                    Layout::left_to_right(Align::Center),
                    |ui| {
                        ui.add_space(12.0);
                        ui.set_min_width(body_w - 24.0);
                        let rt = egui::RichText::new(&lang_disp)
                            .font(FontId::new(10.5, crate::theme::mono_family()))
                            .color(pal.text_faint);
                        let mut job = egui::text::LayoutJob::default();
                        job.append(&lang_disp, 0.0, TextFormat {
                            font_id: FontId::new(10.5, crate::theme::mono_family()),
                            color: pal.text_faint,
                            extra_letter_spacing: 1.4,
                            valign: Align::Center,
                            ..Default::default()
                        });
                        let galley = ui.painter().layout_job(job);
                        let (r, _) = ui.allocate_exact_size(
                            Vec2::new(galley.size().x, 30.0), Sense::hover());
                        ui.painter().galley(
                            Pos2::new(r.min.x, r.center().y - galley.size().y / 2.0), galley, pal.text_faint);
                        let _ = rt;

                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            ui.add_space(8.0);
                            let label = if copied_just { "已复制" } else { "复制" };
                            let btn = egui::Button::new(
                                    egui::RichText::new(label)
                                        .font(FontId::new(11.0, crate::theme::main_family()))
                                        .color(pal.text_dim),
                                )
                                .fill(Color32::from_rgb(0x25, 0x2B, 0x38))
                                .stroke(Stroke::new(1.0, pal.code_border))
                                .corner_radius(CornerRadius::same(5))
                                .small();
                            if ui.add(btn).clicked() {
                                ui.ctx().copy_text(code_owned.clone());
                                self.copied.insert(hash, Instant::now());
                            }
                        });
                    },
                );
                // 分隔线
                let (r, _) = ui.allocate_exact_size(Vec2::new(body_w, 1.0), Sense::hover());
                ui.painter().rect_filled(r, 0, pal.code_border);
                // ---- 代码体 ----
                ui.allocate_ui_with_layout(
                    Vec2::new(body_w, 0.0),
                    Layout::top_down(Align::LEFT),
                    |ui| {
                        ui.add_space(6.0);
                        let code_w = body_w - 12.0 - 40.0;
                        egui::Grid::new(egui::Id::new(hash))
                            .num_columns(2)
                            .spacing([0.0, 1.0])
                            .show(ui, |ui| {
                                for (i, line) in lines.iter().enumerate() {
                                    // 行号
                                    let num = format!("{}", i + 1);
                                    let mut job = egui::text::LayoutJob::default();
                                    let fmt = TextFormat {
                                        font_id: FontId::new(11.0, crate::theme::mono_family()),
                                        color: tint_over(pal.text_faint, pal.code_bg, 0.85),
                                        line_height: Some(19.0),
                                        valign: Align::Center,
                                        ..Default::default()
                                    };
                                    job.append(&num, 0.0, fmt);
                                    let g = ui.painter().layout_job(job);
                                    let (r, _) = ui.allocate_exact_size(
                                        Vec2::new(40.0, g.size().y), Sense::hover());
                                    ui.painter().galley(
                                        Pos2::new(r.right() - g.size().x - 10.0, r.min.y), g, pal.text_faint);
                                    // 代码行
                                    let mut job = egui::text::LayoutJob::default();
                                    for (c, s) in line {
                                        let t = if s.is_empty() { " " } else { s };
                                        job.append(t, 0.0, TextFormat {
                                            font_id: FontId::new(13.0, crate::theme::mono_family()),
                                            color: *c,
                                            line_height: Some(19.0),
                                            valign: Align::Center,
                                            ..Default::default()
                                        });
                                    }
                                    job.wrap.max_width = code_w;
                                    let g = ui.painter().layout_job(job);
                                    let (r, _) = ui.allocate_exact_size(
                                        Vec2::new(code_w, g.size().y), Sense::hover());
                                    ui.painter().galley(r.min, g, pal.text);
                                }
                            });
                        ui.add_space(8.0);
                    },
                );
            });
    }

    fn quote(&mut self, ui: &mut Ui, kind: Option<CalloutKind>, blocks: &[Block]) {
        let pal = self.env.pal;
        let (bg, bar, name) = match kind {
            Some(k) => {
                let c = pal.callouts[k.index()];
                (tint_over(c, pal.bg, 0.09), c, Some(CALLOUT_NAMES[k.index()]))
            }
            None => (pal.quote_bg, tint_over(pal.accent, pal.bg, 0.45), None),
        };
        let m_top = if kind.is_some() { 10 } else { 9 };
        let resp = Frame::new()
            .fill(bg)
            .corner_radius(CornerRadius::same(8))
            .inner_margin(Margin { left: 18, right: 16, top: m_top, bottom: m_top })
            .show(ui, |ui| {
                if let Some(n) = name {
                    let c = kind.map(|k| pal.callouts[k.index()]).unwrap();
                    let mut job = egui::text::LayoutJob::default();
                    job.append(n, 0.0, TextFormat {
                        font_id: FontId::new(12.5, crate::theme::main_semibold()),
                        color: c,
                        valign: Align::Center,
                        ..Default::default()
                    });
                    let g = ui.painter().layout_job(job);
                    let (r, _) = ui.allocate_exact_size(
                        Vec2::new(ui.available_width(), g.size().y), Sense::hover());
                    ui.painter().galley(r.min, g, c);
                    ui.add_space(2.0);
                }
                self.blocks(ui, blocks, true);
            });
        let rect = resp.response.rect;
        let bar_rect = Rect::from_min_size(
            rect.left_top() + Vec2::new(0.0, 5.0),
            Vec2::new(3.0, rect.height() - 10.0),
        );
        ui.painter()
            .rect_filled(bar_rect, CornerRadius::same(2), bar);
    }

    fn list(&mut self, ui: &mut Ui, ordered: bool, start: u64, items: &[crate::markdown::Item]) {
        let pal = self.env.pal;
        let mut n = start;
        for item in items {
            let row_h = 23.0 * self.env.scale;
            ui.horizontal(|ui| {
                // 标记列
                let mw = if item.task.is_some() { 20.0 } else { 24.0 };
                let (mr, _) = ui.allocate_exact_size(Vec2::new(mw, row_h), Sense::hover());
                if let Some(done) = item.task {
                    let box_rect = Rect::from_min_size(
                        Pos2::new(mr.left(), mr.center().y - 7.0),
                        Vec2::new(14.0, 14.0),
                    );
                    if done {
                        ui.painter().rect_filled(box_rect, CornerRadius::same(4), self.env.accent);
                        let mut job = egui::text::LayoutJob::default();
                        job.append("✓", 0.0, TextFormat {
                            font_id: FontId::new(10.5, crate::theme::main_bold()),
                            color: Color32::WHITE,
                            valign: Align::Center,
                            ..Default::default()
                        });
                        let g = ui.painter().layout_job(job);
                        ui.painter().galley(
                            Pos2::new(box_rect.center().x - g.size().x / 2.0,
                                      box_rect.center().y - g.size().y / 2.0),
                            g, Color32::WHITE);
                    } else {
                        ui.painter().rect_stroke(box_rect, CornerRadius::same(4),
                            Stroke::new(1.4, pal.text_faint), egui::StrokeKind::Inside);
                    }
                } else if ordered {
                    let label = format!("{}.", n);
                    let mut job = egui::text::LayoutJob::default();
                    job.append(&label, 0.0, TextFormat {
                        font_id: FontId::new(13.5, crate::theme::mono_family()),
                        color: tint_over(self.env.accent, pal.bg, 0.75),
                        valign: Align::Center,
                        ..Default::default()
                    });
                    let g = ui.painter().layout_job(job);
                    ui.painter().galley(
                        Pos2::new(mr.right() - g.size().x, mr.center().y - g.size().y / 2.0),
                        g, self.env.accent);
                    n += 1;
                } else {
                    let mut job = egui::text::LayoutJob::default();
                    job.append("•", 0.0, TextFormat {
                        font_id: FontId::new(15.0, crate::theme::main_bold()),
                        color: self.env.accent,
                        valign: Align::Center,
                        ..Default::default()
                    });
                    let g = ui.painter().layout_job(job);
                    ui.painter().galley(
                        Pos2::new(mr.right() - g.size().x - 2.0, mr.center().y - g.size().y / 2.0),
                        g, self.env.accent);
                }
                // 内容
                ui.vertical(|ui| {
                    self.blocks_first_tight(ui, &item.blocks);
                });
            });
            ui.add_space(2.0);
        }
    }

    /// 列表项内部：首段紧凑渲染，其余正常。
    fn blocks_first_tight(&mut self, ui: &mut Ui, blocks: &[Block]) {
        let mut i = 0;
        if let Some(Block::Para(inl)) = blocks.first() {
            self.paragraph(ui, inl, true);
            i = 1;
        }
        if blocks.len() > i {
            ui.add_space(3.0);
            self.blocks(ui, &blocks[i..], false);
        }
    }

    fn table(&mut self, ui: &mut Ui, head: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>]) {
        let pal = self.env.pal;
        let avail = ui.available_width();
        let pad_x = 11.0;
        let pad_y = 7.0;
        let ncols = head
            .len()
            .max(rows.iter().map(|r| r.len()).max().unwrap_or(0))
            .max(1);

        // 先按不换行测自然宽度
        let mut widths = vec![0.0f32; ncols];
        self.measure_cells(ui, head, &mut widths, true);
        for r in rows {
            self.measure_cells(ui, r, &mut widths, false);
        }
        for w in widths.iter_mut() {
            *w += pad_x * 2.0;
        }
        let total: f32 = widths.iter().sum();
        let scale = if total > avail { (avail / total).min(1.0) } else { 1.0 };
        for w in widths.iter_mut() {
            *w = (*w * scale).max(52.0);
        }
        let total_w: f32 = widths.iter().sum();

        if !head.is_empty() {
            let galleys = self.layout_cells(ui, head, &widths, pad_x, true);
            self.draw_table_row(ui, &galleys, &widths, total_w, pad_x, pad_y, pal, true, 0);
            // 表头底线加重
            let y = ui.cursor().top();
            let x0 = ui.cursor().left();
            ui.painter().line_segment(
                [Pos2::new(x0, y), Pos2::new(x0 + total_w, y)],
                Stroke::new(2.0, tint_over(self.env.accent, pal.bg, 0.55)),
            );
        }
        for (idx, r) in rows.iter().enumerate() {
            let galleys = self.layout_cells(ui, r, &widths, pad_x, false);
            self.draw_table_row(ui, &galleys, &widths, total_w, pad_x, pad_y, pal, false, idx);
        }
        ui.add_space(2.0);
    }

    fn cell_bf(pal: &Palette, bold: bool) -> BaseFmt {
        BaseFmt {
            size: 14.0,
            fam: crate::theme::main_family(),
            color: pal.text,
            bold,
            italic: false,
        }
    }

    fn measure_cells(
        &mut self,
        ui: &mut Ui,
        cells: &[Vec<Inline>],
        widths: &mut [f32],
        bold: bool,
    ) {
        let pal = self.env.pal;
        for (c, cell) in cells.iter().enumerate() {
            let mut jb = self.build_job(cell, &Self::cell_bf(pal, bold));
            jb.job.wrap.max_width = f32::INFINITY;
            let g = ui.painter().layout_job(std::mem::take(&mut jb.job));
            if c < widths.len() {
                widths[c] = widths[c].max(g.size().x);
            }
        }
    }

    fn layout_cells(
        &mut self,
        ui: &mut Ui,
        cells: &[Vec<Inline>],
        widths: &[f32],
        pad_x: f32,
        bold: bool,
    ) -> Vec<Arc<egui::text::Galley>> {
        let pal = self.env.pal;
        cells
            .iter()
            .enumerate()
            .map(|(c, cell)| {
                let mut jb = self.build_job(cell, &Self::cell_bf(pal, bold));
                let max_w = widths.get(c).copied().unwrap_or(80.0) - pad_x * 2.0;
                jb.job.wrap.max_width = max_w.max(30.0);
                ui.painter().layout_job(std::mem::take(&mut jb.job))
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_table_row(
        &mut self,
        ui: &mut Ui,
        cells: &[Arc<egui::text::Galley>],
        widths: &[f32],
        total_w: f32,
        pad_x: f32,
        pad_y: f32,
        pal: &Palette,
        is_head: bool,
        idx: usize,
    ) {
        let h = cells
            .iter()
            .map(|g| g.size().y)
            .fold(18.0f32, f32::max)
            + pad_y * 2.0;
        let (rect, _) = ui.allocate_exact_size(Vec2::new(total_w, h), Sense::hover());
        if is_head {
            ui.painter()
                .rect_filled(rect, CornerRadius::same(0), tint_over(pal.panel2, pal.bg, 0.7));
        } else if idx % 2 == 1 {
            ui.painter()
                .rect_filled(rect, CornerRadius::same(0), tint_over(pal.panel2, pal.bg, 0.45));
        }
        let mut x = rect.left();
        for (c, g) in cells.iter().enumerate() {
            let cw = widths.get(c).copied().unwrap_or(80.0);
            ui.painter().galley(
                Pos2::new(x + pad_x, rect.center().y - g.size().y / 2.0),
                g.clone(),
                pal.text,
            );
            x += cw;
        }
        ui.painter().line_segment(
            [rect.left_bottom(), rect.right_bottom()],
            Stroke::new(1.0, pal.border),
        );
    }

    fn rule(&mut self, ui: &mut Ui) {
        let pal = self.env.pal;
        ui.add_space(4.0);
        let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 1.0), Sense::hover());
        ui.painter().rect_filled(r, 0, pal.border);
        ui.add_space(4.0);
    }

    fn image(&mut self, ui: &mut Ui, src: &str, alt: &[Inline]) {
        let uri = if src.starts_with("http://")
            || src.starts_with("https://")
            || src.starts_with("file:")
            || src.starts_with("data:")
        {
            src.to_string()
        } else {
            let p = norm_path(&self.env.base_dir.join(src));
            format!("file:///{}", p.display().to_string().replace('\\', "/"))
        };
        let alt_text = crate::markdown::plain_of(alt);
        let resp = ui
            .add(
                egui::Image::new(uri)
                    .max_width(ui.available_width() - 24.0),
            );
        if resp.hovered() {
            ui.ctx().set_cursor_icon(CursorIcon::Default);
        }
        if !alt_text.is_empty() {
            let pal = self.env.pal;
            let mut job = egui::text::LayoutJob::default();
            job.append(&alt_text, 0.0, TextFormat {
                font_id: FontId::new(12.0, crate::theme::main_family()),
                color: pal.text_faint,
                valign: Align::Center,
                ..Default::default()
            });
            job.wrap.max_width = ui.available_width();
            let g = ui.painter().layout_job(job);
            let (r, _) = ui.allocate_exact_size(
                Vec2::new(ui.available_width(), g.size().y), Sense::hover());
            ui.painter().galley(
                Pos2::new(r.min.x, r.min.y), g, pal.text_faint);
        }
        ui.add_space(2.0);
    }

    fn footnote(&mut self, ui: &mut Ui, label: &str, blocks: &[Block]) {
        let mut job = egui::text::LayoutJob::default();
        job.append(&format!("[{label}]"), 0.0, TextFormat {
            font_id: FontId::new(12.0, crate::theme::mono_family()),
            color: self.env.accent,
            valign: Align::Center,
            ..Default::default()
        });
        let g = ui.painter().layout_job(job);
        let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), g.size().y), Sense::hover());
        ui.painter().galley(r.min, g, self.env.accent);
        ui.indent(format!("fn-{label}"), |ui| {
            self.blocks(ui, blocks, true);
        });
    }
}

/// 从 galley 中提取链接点击区域。
fn link_rects(
    galley: &egui::text::Galley,
    pos: Pos2,
    links: &[(Range<usize>, String)],
) -> Vec<(Rect, String)> {
    let mut out = Vec::new();
    if links.is_empty() {
        return out;
    }
    let mut char_idx = 0usize;
    let mut y = 0.0f32;
    for row in &galley.rows {
        let y0 = y;
        let y1 = y + row.size.y;
        y = y1;
        // 该行内每个链接的 x 范围
        let mut segs: Vec<(usize, f32, f32)> = Vec::new();
        for g in &row.glyphs {
            if let Some(li) = links
                .iter()
                .position(|(r, _)| r.contains(&char_idx))
            {
                let x0 = g.pos.x;
                let x1 = g.pos.x + g.advance_width;
                match segs.iter_mut().find(|(i, _, _)| *i == li) {
                    Some((_, a, b)) => {
                        *a = a.min(x0);
                        *b = b.max(x1);
                    }
                    None => segs.push((li, x0, x1)),
                }
            }
            char_idx += 1;
        }
        for (li, x0, x1) in segs {
            let url = links[li].1.clone();
            out.push((
                Rect::from_min_max(
                    Pos2::new(pos.x + x0, pos.y + y0),
                    Pos2::new(pos.x + x1, pos.y + y1),
                ),
                url,
            ));
        }
    }
    out
}

fn norm_path(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            c => out.push(c.as_os_str()),
        }
    }
    out
}

