//! 应用壳：路由、侧栏、顶栏、首页、板块页、阅读页、目录面板与搜索。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use egui::{
    Align, Color32, CornerRadius, FontId, Frame, Id, Key, Margin, Pos2, Rect, Sense, Stroke,
    TextFormat, Ui, Vec2,
};

use crate::content::Library;
use crate::highlight::{Highlighter, Line};
use crate::markdown::Doc;
use crate::render::{Action, Env, Renderer};
use crate::theme::{self, Palette, DARK, LIGHT};

#[derive(Clone, PartialEq)]
enum View {
    Home,
    Section(String),
    Article(String),
}

#[derive(Clone)]
struct SearchHit {
    sec_name: String,
    accent: Color32,
    title: String,
    rel: String,
    score: usize,
    snippet: String,
}

pub struct App {
    root: PathBuf,
    lib: Library,
    view: View,
    search: String,
    last_search: String,
    search_results: Vec<SearchHit>,
    docs: HashMap<String, (std::time::SystemTime, Arc<Doc>)>,
    hl: Highlighter,
    code_cache: HashMap<u64, Vec<Line>>,
    copied: HashMap<u64, Instant>,
    heading_y: Vec<f32>,
    scroll_target: Option<f32>,
    scroll_offset: f32,
    expanded: HashSet<String>,
    font_scale: f32,
    dark: bool,
    pending_urls: Vec<String>,
    last_check: Instant,
}

fn find_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("knowledge").is_dir() {
        return cwd.join("knowledge");
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().skip(1).take(3) {
            let cand = anc.join("knowledge");
            if cand.is_dir() {
                return cand;
            }
        }
    }
    cwd.join("knowledge")
}

impl App {
    pub fn new(cc: &eframe::CreationContext) -> Self {
        theme::load_fonts(&cc.egui_ctx);
        theme::install_styles(&cc.egui_ctx);
        cc.egui_ctx.set_theme(egui::ThemePreference::Dark);
        let root = find_root();
        let lib = Library::load(&root);
        Self {
            root,
            lib,
            view: View::Home,
            search: String::new(),
            last_search: String::new(),
            search_results: Vec::new(),
            docs: HashMap::new(),
            hl: Highlighter::new(),
            code_cache: HashMap::new(),
            copied: HashMap::new(),
            heading_y: Vec::new(),
            scroll_target: None,
            scroll_offset: 0.0,
            expanded: HashSet::new(),
            font_scale: 1.0,
            dark: true,
            pending_urls: Vec::new(),
            last_check: Instant::now(),
        }
    }

    fn pal(&self) -> &'static Palette {
        if self.dark { &DARK } else { &LIGHT }
    }

    fn reload(&mut self) {
        self.lib = Library::load(&self.root);
        self.docs.clear();
        self.heading_y.clear();
        if self.code_cache.len() > 800 {
            self.code_cache.clear();
        }
    }

    fn goto(&mut self, v: View) {
        self.view = v;
        self.search.clear();
        self.heading_y.clear();
        self.scroll_target = None;
        self.scroll_offset = 0.0;
        let sec_id = self.current_section_id();
        if let Some(id) = sec_id {
            self.expanded.insert(id);
        }
    }

    fn current_section_id(&self) -> Option<String> {
        match &self.view {
            View::Section(id) => Some(id.clone()),
            View::Article(rel) => Some(rel.split('/').next().unwrap_or("").to_string()),
            View::Home => None,
        }
    }
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // 自动重载：定期比对内容指纹
        if self.last_check.elapsed() > Duration::from_millis(900) {
            self.last_check = Instant::now();
            if crate::content::scan_fingerprint(&self.root) != self.lib.fingerprint {
                self.reload();
            }
        }
        // 心跳：内容目录变化后能自动刷出，无需用户输入
        ctx.request_repaint_after(Duration::from_millis(500));
        // 渲染期间收集的外链动作
        for url in std::mem::take(&mut self.pending_urls) {
            ctx.open_url(egui::OpenUrl::new_tab(url));
        }
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();

        // ---- 全局输入 ----
        if ctx.input(|i| i.key_pressed(Key::F5)) {
            self.reload();
        }
        let ctrl_k = ctx.input(|i| i.modifiers.ctrl && i.key_pressed(Key::K));
        let esc = ctx.input(|i| i.key_pressed(Key::Escape));
        if esc && !self.search.is_empty() {
            self.search.clear();
        }

        let pal = self.pal();

        // ---- 侧栏 ----
        egui::Panel::left("sidebar")
            .resizable(false)
            .exact_size(264.0)
            .frame(Frame::new().fill(pal.panel).inner_margin(Margin {
                left: 12,
                right: 12,
                top: 14,
                bottom: 10,
            }))
            .show(ui, |ui| {
                self.sidebar(ui);
                let r = ui.max_rect();
                ui.painter().line_segment(
                    [Pos2::new(r.right(), r.top()), Pos2::new(r.right(), r.bottom())],
                    Stroke::new(1.0, pal.border),
                );
            });
        if ctrl_k {
            ctx.memory_mut(|m| m.request_focus(Id::new("global_search")));
        }

        // ---- 顶栏 ----
        egui::Panel::top("topbar")
            .resizable(false)
            .exact_size(46.0)
            .frame(Frame::new().fill(pal.bg).inner_margin(Margin::ZERO))
            .show(ui, |ui| {
                self.topbar(ui);
                let r = ui.max_rect();
                ui.painter().line_segment(
                    [Pos2::new(r.left(), r.bottom()), Pos2::new(r.right(), r.bottom())],
                    Stroke::new(1.0, pal.border),
                );
            });

        // ---- 目录面板（阅读页且标题足够多时）----
        let toc_headings: Option<Vec<(u8, String)>> = match &self.view {
            View::Article(rel) => {
                let headings = self
                    .docs
                    .get(rel)
                    .map(|(_, d)| d.headings.clone())
                    .unwrap_or_default();
                (headings.len() >= 3).then_some(headings)
            }
            _ => None,
        };
        if let Some(headings) = toc_headings {
            let pal = self.pal();
            let heading_y = self.heading_y.clone();
            let scroll_offset = self.scroll_offset;
            egui::Panel::right("toc")
                .resizable(false)
                .exact_size(224.0)
                .frame(Frame::new().fill(pal.bg).inner_margin(Margin {
                    left: 14,
                    right: 14,
                    top: 26,
                    bottom: 12,
                }))
                .show(ui, |ui| {
                    self.toc_panel(ui, &headings, &heading_y, scroll_offset);
                    let r = ui.max_rect();
                    ui.painter().line_segment(
                        [Pos2::new(r.left(), r.top()), Pos2::new(r.left(), r.bottom())],
                        Stroke::new(1.0, pal.border),
                    );
                });
        }

        // ---- 中央内容 ----
        egui::CentralPanel::default()
            .frame(Frame::new().fill(pal.bg).inner_margin(Margin::ZERO))
            .show(ui, |ui| {
                if !self.search.trim().is_empty() {
                    self.page_search(ui);
                } else {
                    match self.view.clone() {
                        View::Home => self.page_home(ui),
                        View::Section(id) => self.page_section(ui, &id),
                        View::Article(rel) => self.page_article(ui, &rel),
                    }
                }
            });

        self.copied.retain(|_, t| t.elapsed().as_secs_f32() < 3.0);
    }
}

// ================= 侧栏 / 顶栏 / 目录 =================

impl App {
    fn sidebar(&mut self, ui: &mut Ui) {
        let pal = self.pal();
        let avail = ui.available_width();

        // 品牌
        let (r, resp) = ui.allocate_exact_size(Vec2::new(avail, 40.0), Sense::click());
        if resp.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let logo = Rect::from_min_size(r.left_top() + Vec2::new(2.0, 4.0), Vec2::new(30.0, 30.0));
        ui.painter()
            .rect_filled(logo, CornerRadius::same(8), pal.accent);
        ui.painter().text(
            logo.center(),
            egui::Align2::CENTER_CENTER,
            "知",
            FontId::new(16.0, theme::main_bold()),
            Color32::WHITE,
        );
        ui.painter().text(
            Pos2::new(logo.right() + 12.0, r.center().y - 8.0),
            egui::Align2::LEFT_CENTER,
            "知识库",
            FontId::new(15.0, theme::main_bold()),
            pal.text,
        );
        let mut job = egui::text::LayoutJob::default();
        job.append("KNOWLEDGE VAULT", 0.0, TextFormat {
            font_id: FontId::new(8.5, theme::mono_family()),
            color: pal.text_faint,
            extra_letter_spacing: 1.6,
            valign: Align::Center,
            ..Default::default()
        });
        let g = ui.painter().layout_job(job);
        ui.painter().galley(
            Pos2::new(logo.right() + 12.0, r.center().y + 9.0),
            g,
            pal.text_faint,
        );
        if resp.clicked() {
            self.goto(View::Home);
        }

        ui.add_space(10.0);

        // 搜索框
        let edit = egui::TextEdit::singleline(&mut self.search)
            .hint_text("  搜索知识…  Ctrl+K")
            .desired_width(avail - 8.0)
            .id(Id::new("global_search"))
            .frame(
                Frame::new()
                    .fill(pal.panel2)
                    .stroke(Stroke::new(1.0, pal.border))
                    .corner_radius(CornerRadius::same(7))
                    .inner_margin(Margin::symmetric(6, 5)),
            );
        ui.add_sized([avail - 8.0, 32.0], edit);

        ui.add_space(8.0);

        // 板块列表
        egui::ScrollArea::vertical()
            .auto_shrink(false)
            .id_salt("sidebar")
            .show(ui, |ui| {
                let secs: Vec<(String, String, Color32, usize)> = self
                    .lib
                    .sections
                    .iter()
                    .map(|s| {
                        (
                            s.meta.id.to_string(),
                            s.meta.name.to_string(),
                            s.meta.accent,
                            s.articles.len(),
                        )
                    })
                    .collect();
                let current = self.current_section_id();
                for (id, name, accent, count) in secs {
                    let open = self.expanded.contains(&id) || current.as_deref() == Some(&id);
                    let active = current.as_deref() == Some(&id);
                    let (r, resp) = ui.allocate_exact_size(Vec2::new(avail, 32.0), Sense::click());
                    if resp.hovered() {
                        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                        ui.painter().rect_filled(
                            r,
                            CornerRadius::same(7),
                            tint(pal.panel2, pal.bg, 0.6),
                        );
                    }
                    ui.painter()
                        .circle_filled(Pos2::new(r.left() + 11.0, r.center().y), 3.5, accent);
                    ui.painter().text(
                        Pos2::new(r.left() + 24.0, r.center().y),
                        egui::Align2::LEFT_CENTER,
                        &name,
                        FontId::new(13.5, theme::main_semibold()),
                        if active { pal.text } else { pal.text_dim },
                    );
                    // 数量徽章 pill
                    let cnt = count.to_string();
                    let cw_ = cnt.chars().count() as f32 * 6.5 + 12.0;
                    let pill = Rect::from_min_size(
                        Pos2::new(r.right() - cw_, r.center().y - 8.0),
                        Vec2::new(cw_, 16.0),
                    );
                    ui.painter().rect_filled(
                        pill,
                        CornerRadius::same(8),
                        if active || resp.hovered() {
                            tint(accent, pal.bg, 0.15)
                        } else {
                            tint(pal.panel2, pal.bg, 0.8)
                        },
                    );
                    ui.painter().text(
                        pill.center(),
                        egui::Align2::CENTER_CENTER,
                        &cnt,
                        FontId::new(9.5, theme::mono_family()),
                        if active || resp.hovered() {
                            tint(accent, pal.bg, 0.95)
                        } else {
                            pal.text_faint
                        },
                    );
                    if resp.clicked() {
                        if open && active {
                            self.expanded.remove(&id);
                        } else {
                            self.expanded.insert(id.clone());
                            self.goto(View::Section(id.clone()));
                        }
                    }

                    if open {
                        if let Some(sec) = self.lib.section(&id) {
                            let arts: Vec<(String, String)> = sec
                                .articles
                                .iter()
                                .map(|a| (a.rel.clone(), a.title.clone()))
                                .collect();
                            for (rel, title) in arts {
                                let active_a =
                                    matches!(&self.view, View::Article(v) if *v == rel);
                                let (r, resp) =
                                    ui.allocate_exact_size(Vec2::new(avail, 27.0), Sense::click());
                                if active_a {
                                    ui.painter().rect_filled(
                                        r,
                                        CornerRadius::same(6),
                                        tint(pal.panel2, pal.bg, 0.75),
                                    );
                                    ui.painter().line_segment(
                                        [
                                            Pos2::new(r.left() + 1.0, r.top() + 5.0),
                                            Pos2::new(r.left() + 1.0, r.bottom() - 5.0),
                                        ],
                                        Stroke::new(2.5, accent),
                                    );
                                } else if resp.hovered() {
                                    ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                                    ui.painter().rect_filled(
                                        r,
                                        CornerRadius::same(6),
                                        tint(pal.panel2, pal.bg, 0.45),
                                    );
                                }
                                ui.painter().text(
                                    Pos2::new(r.left() + 16.0, r.center().y),
                                    egui::Align2::LEFT_CENTER,
                                    &title,
                                    FontId::new(12.8, theme::main_family()),
                                    if active_a { pal.text } else { pal.text_dim },
                                );
                                if resp.clicked() {
                                    self.goto(View::Article(rel));
                                }
                            }
                        }
                        ui.add_space(4.0);
                    }
                }
            });
    }

    fn topbar(&mut self, ui: &mut Ui) {
        let pal = self.pal();
        ui.horizontal(|ui| {
            ui.add_space(20.0);
            // ---- 左侧：面包屑 ----
            if crumb(ui, "首页", false, pal).clicked() {
                self.goto(View::Home);
            }
            match self.view.clone() {
                View::Section(id) => {
                    crumb_sep(ui, pal);
                    let name = self
                        .lib
                        .section(&id)
                        .map(|s| s.meta.name.to_string())
                        .unwrap_or_else(|| id.clone());
                    crumb(ui, &name, true, pal);
                }
                View::Article(rel) => {
                    let (sec_name, sec_id, title) = match self.lib.article(&rel) {
                        Some(a) => (
                            self.lib
                                .section_of(&rel)
                                .map(|s| s.meta.name.to_string())
                                .unwrap_or_default(),
                            rel.split('/').next().unwrap_or("").to_string(),
                            a.title.clone(),
                        ),
                        None => (String::new(), String::new(), rel.clone()),
                    };
                    if !sec_name.is_empty() {
                        crumb_sep(ui, pal);
                        if crumb(ui, &sec_name, false, pal).clicked() {
                            self.goto(View::Section(sec_id));
                        }
                    }
                    crumb_sep(ui, pal);
                    crumb(ui, &title, true, pal);
                }
                View::Home => {
                    crumb_sep(ui, pal);
                    crumb(ui, "总览", true, pal);
                }
            }

            // ---- 右侧：操作按钮 ----
            let total = ui.available_width() + ui.min_rect().width();
            let used = ui.min_rect().width();
            let reserve = 250.0;
            if total - used > reserve {
                ui.add_space(total - used - reserve);
            }
            if icon_btn(ui, "刷新", pal).clicked() {
                self.reload();
            }
            ui.add_space(4.0);
            let theme_label = if self.dark { "浅色" } else { "深色" };
            if icon_btn(ui, theme_label, pal).clicked() {
                self.dark = !self.dark;
                ui.ctx().set_theme(if self.dark {
                    egui::ThemePreference::Dark
                } else {
                    egui::ThemePreference::Light
                });
            }
            ui.add_space(4.0);
            if icon_btn(ui, "A+", pal).clicked() {
                self.font_scale = (self.font_scale + 0.05).min(1.3);
            }
            ui.add_space(2.0);
            if icon_btn(ui, "A−", pal).clicked() {
                self.font_scale = (self.font_scale - 0.05).max(0.85);
            }
            ui.add_space(14.0);
        });
    }

    fn toc_panel(
        &mut self,
        ui: &mut Ui,
        headings: &[(u8, String)],
        heading_y: &[f32],
        scroll_offset: f32,
    ) {
        let pal = self.pal();
        let mut job = egui::text::LayoutJob::default();
        job.append("本页目录", 0.0, TextFormat {
            font_id: FontId::new(10.5, theme::main_semibold()),
            color: pal.text_faint,
            extra_letter_spacing: 1.2,
            valign: Align::Center,
            ..Default::default()
        });
        let g = ui.painter().layout_job(job);
        let (r, _) =
            ui.allocate_exact_size(Vec2::new(ui.available_width(), g.size().y), Sense::hover());
        ui.painter().galley(r.min, g, pal.text_faint);
        ui.add_space(8.0);

        let mut active: isize = -1;
        for (i, &y) in heading_y.iter().enumerate() {
            if y <= scroll_offset + 140.0 {
                active = i as isize;
            }
        }

        for (i, (level, title)) in headings.iter().enumerate() {
            let is_active = i as isize == active;
            let h = if *level <= 2 { 26.0 } else { 23.0 };
            let indent = (*level as f32 - 2.0).max(0.0) * 14.0;
            let (r, resp) =
                ui.allocate_exact_size(Vec2::new(ui.available_width(), h), Sense::click());
            if is_active {
                ui.painter()
                    .rect_filled(r, CornerRadius::same(5), tint(pal.panel2, pal.bg, 0.8));
                ui.painter().line_segment(
                    [
                        Pos2::new(r.left() + 0.5, r.top() + 4.0),
                        Pos2::new(r.left() + 0.5, r.bottom() - 4.0),
                    ],
                    Stroke::new(2.0, pal.accent),
                );
            } else if resp.hovered() {
                ui.painter()
                    .rect_filled(r, CornerRadius::same(5), tint(pal.panel2, pal.bg, 0.4));
            }
            if resp.hovered() || is_active {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            let color = if is_active {
                pal.text
            } else if resp.hovered() {
                pal.text_dim
            } else {
                tint(pal.text_dim, pal.bg, 0.75)
            };
            let size = if *level <= 2 { 12.2 } else { 11.6 };
            let mut job = egui::text::LayoutJob::default();
            job.append(title, 0.0, TextFormat {
                font_id: FontId::new(size, theme::main_family()),
                color,
                valign: Align::Center,
                ..Default::default()
            });
            job.wrap.max_width = ui.available_width() - indent - 10.0;
            job.wrap.max_rows = 1;
            job.wrap.break_anywhere = true;
            let g = ui.painter().layout_job(job);
            ui.painter().galley(
                Pos2::new(r.left() + 8.0 + indent, r.center().y - g.size().y / 2.0),
                g,
                color,
            );
            if resp.clicked() {
                if let Some(&y) = heading_y.get(i) {
                    self.scroll_target = Some(y);
                }
            }
        }
    }
}

// ================= 页面 =================

impl App {
    fn page_home(&mut self, ui: &mut Ui) {
        let pal = self.pal();
        egui::ScrollArea::vertical()
            .auto_shrink(false)
            .id_salt("home")
            .show(ui, |ui| {
                let avail = ui.available_width();
                let w = 1020.0f32.min(avail - 56.0);
                let m = ((avail - w) / 2.0).max(16.0);
                ui.add_space(24.0);
                ui.horizontal(|ui| {
                    ui.add_space(m);
                    ui.vertical(|ui| {
                        ui.set_width(w);

                        // ---- Hero：右侧品牌色光晕 + 大标题 + 统计数字 ----
                        let hero_h = 148.0;
                        let (hero_rect, _) =
                            ui.allocate_exact_size(Vec2::new(w, hero_h), Sense::hover());
                        let painter = ui.painter_at(hero_rect);
                        // 光晕：从右上角向左下的品牌色渐变衰减
                        theme::gradient_h(
                            &painter,
                            Rect::from_min_size(
                                Pos2::new(hero_rect.right() - 520.0, hero_rect.top() - 40.0),
                                Vec2::new(520.0, hero_h + 60.0),
                            ),
                            Color32::from_rgba_unmultiplied(0x8B, 0x93, 0xF8, 0),
                            Color32::from_rgba_unmultiplied(0x8B, 0x93, 0xF8, 26),
                        );
                        // 渐变短线（品牌感）
                        theme::gradient_h(
                            &painter,
                            Rect::from_min_size(
                                Pos2::new(hero_rect.left() + 1.0, hero_rect.top() + 14.0),
                                Vec2::new(64.0, 4.0),
                            ),
                            Color32::from_rgb(0x8B, 0x93, 0xF8),
                            Color32::from_rgb(0x5E, 0xE0, 0xC8),
                        );
                        painter.text(
                            Pos2::new(hero_rect.left() + 2.0, hero_rect.top() + 62.0),
                            egui::Align2::LEFT_CENTER,
                            "知识库",
                            FontId::new(38.0, theme::main_bold()),
                            pal.text,
                        );
                        painter.text(
                            Pos2::new(hero_rect.left() + 2.0, hero_rect.top() + 98.0),
                            egui::Align2::LEFT_CENTER,
                            "把零散的知识，沉淀成体系。",
                            FontId::new(15.0, theme::main_family()),
                            pal.text_dim,
                        );
                        // 统计数字块
                        let (ns, na) = self.lib.stats();
                        let words: usize = self
                            .lib
                            .all_articles()
                            .map(|(_, a)| a.plain.chars().count())
                            .sum();
                        let stats: [(String, &str); 3] = [
                            (ns.to_string(), "个板块"),
                            (na.to_string(), "篇笔记"),
                            (format!("{:.1}", words as f32 / 10000.0), "万字"),
                        ];
                        let mut sx = hero_rect.left() + 2.0;
                        for (num, label) in stats {
                            painter.text(
                                Pos2::new(sx, hero_rect.top() + 130.0),
                                egui::Align2::LEFT_BOTTOM,
                                &num,
                                FontId::new(19.0, theme::main_bold()),
                                pal.text,
                            );
                            let num_w = painter
                                .layout_no_wrap(
                                    num.clone(),
                                    FontId::new(19.0, theme::main_bold()),
                                    pal.text,
                                )
                                .size()
                                .x;
                            sx += num_w + 5.0;
                            painter.text(
                                Pos2::new(sx, hero_rect.top() + 128.0),
                                egui::Align2::LEFT_BOTTOM,
                                label,
                                FontId::new(11.5, theme::main_family()),
                                pal.text_faint,
                            );
                            sx += label.chars().count() as f32 * 12.0 + 22.0;
                        }

                        // ---- 板块卡片 ----
                        let cards: Vec<(String, String, String, String, Color32, usize)> = self
                            .lib
                            .sections
                            .iter()
                            .map(|s| {
                                (
                                    s.meta.id.to_string(),
                                    s.meta.name.to_string(),
                                    s.meta.glyph.to_string(),
                                    s.meta.desc.to_string(),
                                    s.meta.accent,
                                    s.articles.len(),
                                )
                            })
                            .collect();
                        let cols = ((w / 310.0) as usize).clamp(2, 3);
                        let gap = 14.0;
                        let cw = (w - gap * (cols as f32 - 1.0)) / cols as f32;
                        for chunk in cards.chunks(cols) {
                            ui.horizontal(|ui| {
                                for (id, name, glyph, desc, accent, count) in chunk {
                                    self.home_card(ui, cw, id, name, glyph, desc, *accent, *count);
                                    ui.add_space(gap);
                                }
                            });
                            ui.add_space(gap);
                        }
                        ui.add_space(18.0);
                        paint_line(
                            ui,
                            "提示：编辑 knowledge/ 目录下的 Markdown 文件，内容会自动刷新（或按 F5）。",
                            FontId::new(12.0, theme::main_family()),
                            pal.text_faint,
                            20.0,
                        );
                    });
                });
                ui.add_space(40.0);
            });
    }

    #[allow(clippy::too_many_arguments)]
    fn home_card(
        &mut self,
        ui: &mut Ui,
        w: f32,
        id: &str,
        name: &str,
        glyph: &str,
        desc: &str,
        accent: Color32,
        count: usize,
    ) {
        let pal = self.pal();
        let h = 168.0;
        let (r, resp) = ui.allocate_exact_size(Vec2::new(w, h), Sense::CLICK | Sense::HOVER);
        if resp.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        // 卡片底：hover 提亮
        let fill = if resp.hovered() {
            tint(pal.panel2, pal.bg, 0.95)
        } else {
            tint(pal.panel2, pal.bg, 0.72)
        };
        ui.painter().rect_filled(r, CornerRadius::same(14), fill);
        // 边框：hover 时点亮为板块色
        let stroke = if resp.hovered() {
            Stroke::new(1.4, tint(accent, pal.bg, 0.85))
        } else {
            Stroke::new(1.0, pal.border)
        };
        ui.painter()
            .rect_stroke(r, CornerRadius::same(14), stroke, egui::StrokeKind::Outside);
        // 顶部 1px 内高光，增加"厚度"
        ui.painter().line_segment(
            [
                Pos2::new(r.left() + 10.0, r.top() + 1.0),
                Pos2::new(r.right() - 10.0, r.top() + 1.0),
            ],
            Stroke::new(1.0, Color32::from_rgba_unmultiplied(255, 255, 255, 16)),
        );

        // 大号渐变质感图标：饱和板块底 + 白色 monogram
        let mo = Rect::from_min_size(r.left_top() + Vec2::new(20.0, 20.0), Vec2::new(50.0, 50.0));
        let c_hi = tint(accent, Color32::WHITE, 0.22);
        let c_lo = tint(accent, Color32::BLACK, 0.28);
        let icon_painter = ui.painter_at(r);
        theme::gradient_h(
            &icon_painter,
            mo,
            tint(c_hi, pal.bg, 0.96),
            tint(c_lo, pal.bg, 0.96),
        );
        theme::gloss(&icon_painter, mo, 13);
        icon_painter.text(
            mo.center(),
            egui::Align2::CENTER_CENTER,
            glyph,
            FontId::new(
                if glyph.chars().count() > 2 { 15.0 } else { 19.0 },
                theme::main_bold(),
            ),
            Color32::WHITE,
        );

        // 名称 + 箭头
        ui.painter().text(
            Pos2::new(r.left() + 20.0, mo.bottom() + 22.0),
            egui::Align2::LEFT_CENTER,
            name,
            FontId::new(17.0, theme::main_bold()),
            pal.text,
        );
        if resp.hovered() {
            ui.painter().text(
                Pos2::new(r.left() + 20.0
                    + ui.painter()
                        .layout_no_wrap(
                            name.to_string(),
                            FontId::new(17.0, theme::main_bold()),
                            pal.text,
                        )
                        .size()
                        .x
                    + 8.0,
                    mo.bottom() + 22.0),
                egui::Align2::LEFT_CENTER,
                "→",
                FontId::new(14.0, theme::main_semibold()),
                accent,
            );
        }
        // 描述（最多两行）
        let mut job = egui::text::LayoutJob::default();
        job.append(desc, 0.0, TextFormat {
            font_id: FontId::new(12.2, theme::main_family()),
            color: pal.text_dim,
            line_height: Some(17.5),
            valign: Align::Center,
            ..Default::default()
        });
        job.wrap.max_width = w - 40.0;
        job.wrap.max_rows = 2;
        let g = ui.painter().layout_job(job);
        ui.painter().galley(
            Pos2::new(r.left() + 20.0, mo.bottom() + 36.0),
            g,
            pal.text_dim,
        );
        // 底部状态
        if count > 0 {
            let foot = format!("{count} 篇文章");
            let fw = foot.chars().count() as f32 * 11.0 + 18.0;
            let pill = Rect::from_min_size(
                Pos2::new(r.right() - 16.0 - fw, r.bottom() - 28.0),
                Vec2::new(fw, 20.0),
            );
            ui.painter()
                .rect_filled(pill, CornerRadius::same(10), tint(accent, pal.bg, 0.13));
            ui.painter().text(
                pill.center(),
                egui::Align2::CENTER_CENTER,
                &foot,
                FontId::new(10.5, theme::mono_family()),
                tint(accent, pal.bg, 0.95),
            );
        } else {
            ui.painter().text(
                Pos2::new(r.right() - 16.0, r.bottom() - 18.0),
                egui::Align2::RIGHT_CENTER,
                "筹备中",
                FontId::new(11.0, theme::mono_family()),
                pal.text_faint,
            );
        }
        if resp.clicked() {
            self.goto(View::Section(id.to_string()));
        }
    }

    fn page_section(&mut self, ui: &mut Ui, id: &str) {
        let pal = self.pal();
        let Some(sec) = self.lib.section(id) else {
            ui.centered_and_justified(|ui| {
                ui.label("板块不存在");
            });
            return;
        };
        let meta = (
            sec.meta.name.to_string(),
            sec.meta.glyph.to_string(),
            sec.meta.desc.to_string(),
            sec.meta.accent,
        );
        let arts: Vec<(String, String, String)> = sec
            .articles
            .iter()
            .map(|a| (a.rel.clone(), a.title.clone(), a.summary.clone()))
            .collect();
        let active_rel = match &self.view {
            View::Article(r) => Some(r.clone()),
            _ => None,
        };
        let is_empty = arts.is_empty();
        let root = self.root.clone();

        egui::ScrollArea::vertical()
            .auto_shrink(false)
            .id_salt(format!("sec-{id}"))
            .show(ui, |ui| {
                let avail = ui.available_width();
                let w = 860.0f32.min(avail - 56.0);
                let m = ((avail - w) / 2.0).max(16.0);
                ui.add_space(32.0);
                ui.horizontal(|ui| {
                    ui.add_space(m);
                    ui.vertical(|ui| {
                        ui.set_width(w);
                        // 头部：渐变质感大图标 + 名称 + 描述 + 统计
                        let mo = Rect::from_min_size(
                            ui.cursor().left_top(),
                            Vec2::new(56.0, 56.0),
                        );
                        ui.allocate_exact_size(Vec2::new(60.0, 56.0), Sense::hover());
                        let c_hi = tint(meta.3, Color32::WHITE, 0.22);
                        let c_lo = tint(meta.3, Color32::BLACK, 0.28);
                        theme::gradient_h(ui.painter(), mo, c_hi, c_lo);
                        theme::gloss(ui.painter(), mo, 14);
                        ui.painter().text(
                            mo.center(),
                            egui::Align2::CENTER_CENTER,
                            &meta.1,
                            FontId::new(
                                if meta.1.chars().count() > 2 { 16.0 } else { 21.0 },
                                theme::main_bold(),
                            ),
                            Color32::WHITE,
                        );
                        ui.add_space(14.0);
                        ui.vertical(|ui| {
                            paint_line(ui, &meta.0, FontId::new(24.0, theme::main_bold()), pal.text, 32.0);
                            paint_line(ui, &meta.2, FontId::new(13.0, theme::main_family()), pal.text_dim, 22.0);
                        });
                        ui.add_space(4.0);
                        let count_line = if is_empty {
                            "本板块还在筹备中".to_string()
                        } else {
                            format!("共 {} 篇 · 按学习顺序编排", arts.len())
                        };
                        paint_line(
                            ui,
                            &count_line,
                            FontId::new(12.0, theme::mono_family()),
                            pal.text_faint,
                            24.0,
                        );
                        ui.add_space(10.0);

                        if is_empty {
                            ui.add_space(24.0);
                            empty_state(ui, w, &meta.1, meta.3, pal, &root);
                        } else {
                            for (i, (rel, title, summary)) in arts.iter().enumerate() {
                                self.article_row(
                                    ui,
                                    w,
                                    i,
                                    rel,
                                    title,
                                    summary,
                                    meta.3,
                                    active_rel.as_deref(),
                                );
                                ui.add_space(6.0);
                            }
                        }
                    });
                });
                ui.add_space(40.0);
            });
    }

    #[allow(clippy::too_many_arguments)]
    fn article_row(
        &mut self,
        ui: &mut Ui,
        w: f32,
        idx: usize,
        rel: &str,
        title: &str,
        summary: &str,
        accent: Color32,
        active_rel: Option<&str>,
    ) {
        let pal = self.pal();
        let h = 58.0;
        let (r, resp) = ui.allocate_exact_size(Vec2::new(w, h), Sense::CLICK | Sense::HOVER);
        let active = active_rel == Some(rel);
        if resp.hovered() || active {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        if active {
            ui.painter()
                .rect_filled(r, CornerRadius::same(9), tint(pal.panel2, pal.bg, 0.8));
            ui.painter().line_segment(
                [
                    Pos2::new(r.left() + 1.0, r.top() + 8.0),
                    Pos2::new(r.left() + 1.0, r.bottom() - 8.0),
                ],
                Stroke::new(3.0, accent),
            );
        } else if resp.hovered() {
            ui.painter()
                .rect_filled(r, CornerRadius::same(9), tint(pal.panel2, pal.bg, 0.5));
        }
        let num = format!("{:02}", idx + 1);
        ui.painter().text(
            Pos2::new(r.left() + 18.0, r.center().y),
            egui::Align2::LEFT_CENTER,
            &num,
            FontId::new(13.0, theme::mono_family()),
            tint(accent, pal.bg, if active { 0.95 } else { 0.55 }),
        );
        ui.painter().text(
            Pos2::new(r.left() + 52.0, r.center().y - 10.0),
            egui::Align2::LEFT_CENTER,
            title,
            FontId::new(14.8, theme::main_semibold()),
            pal.text,
        );
        let sum = if summary.is_empty() { " " } else { summary };
        let mut job = egui::text::LayoutJob::default();
        job.append(sum, 0.0, TextFormat {
            font_id: FontId::new(12.0, theme::main_family()),
            color: pal.text_faint,
            valign: Align::Center,
            ..Default::default()
        });
        job.wrap.max_width = w - 70.0;
        job.wrap.max_rows = 1;
        job.wrap.break_anywhere = true;
        let g = ui.painter().layout_job(job);
        ui.painter().galley(
            Pos2::new(r.left() + 52.0, r.center().y + 9.0 - g.size().y / 2.0),
            g,
            pal.text_faint,
        );
        if resp.clicked() {
            self.goto(View::Article(rel.to_string()));
        }
    }

    fn page_article(&mut self, ui: &mut Ui, rel: &str) {
        let pal = self.pal();
        let Some(article) = self.lib.article(rel) else {
            ui.vertical_centered(|ui| {
                ui.add_space(120.0);
                ui.label(
                    egui::RichText::new("文章不存在或已被移动")
                        .font(FontId::new(15.0, theme::main_family()))
                        .color(pal.text_dim),
                );
                if ui.add(egui::Button::new("返回首页")).clicked() {
                    self.goto(View::Home);
                }
            });
            return;
        };
        let mtime = article.mtime;
        let body = article.body.clone();
        let title = article.title.clone();
        let tags = article.tags.clone();
        let accent = self
            .lib
            .section_of(rel)
            .map(|s| s.meta.accent)
            .unwrap_or(pal.accent);
        let base_dir = self.root.join(rel.split('/').next().unwrap_or(""));

        // 解析（带缓存）
        let doc = if self.docs.get(rel).map(|(t, _)| *t) == Some(mtime) {
            self.docs[rel].1.clone()
        } else {
            let d = Arc::new(crate::markdown::parse(&body));
            self.docs.insert(rel.to_string(), (mtime, d.clone()));
            d
        };

        let target = self.scroll_target.take();
        let font_scale = self.font_scale;
        let mut doc_out: Option<crate::render::Out> = None;

        // 导航信息：板块名、序号、阅读时长、上一篇/下一篇
        let sec_id = rel.split('/').next().unwrap_or("").to_string();
        let sec_name = self
            .lib
            .section(&sec_id)
            .map(|s| s.meta.name.to_string())
            .unwrap_or_default();
        let read_min = (body.chars().count() as f32 / 420.0).ceil().max(1.0) as i32;
        let mut prev_nav: Option<(String, String)> = None;
        let mut next_nav: Option<(String, String)> = None;
        let idx_line = {
            let list: Vec<(String, String)> = self
                .lib
                .section(&sec_id)
                .map(|s| {
                    s.articles
                        .iter()
                        .map(|a| (a.rel.clone(), a.title.clone()))
                        .collect()
                })
                .unwrap_or_default();
            match list.iter().position(|(r, _)| r == rel) {
                Some(i) => {
                    if i > 0 {
                        prev_nav = Some(list[i - 1].clone());
                    }
                    if i + 1 < list.len() {
                        next_nav = Some(list[i + 1].clone());
                    }
                    format!("第 {} 篇 · 约 {} 分钟读完", i + 1, read_min)
                }
                None => String::new(),
            }
        };

        let out = egui::ScrollArea::vertical()
            .auto_shrink(false)
            .id_salt(format!("read-{rel}"))
            .show(ui, |ui| {
                if let Some(y) = target {
                    ui.scroll_to_rect(
                        Rect::from_min_size(Pos2::new(0.0, (y - 12.0).max(0.0)), Vec2::ZERO),
                        Some(Align::TOP),
                    );
                }
                let avail = ui.available_width();
                let w = 740.0f32.min(avail - 48.0);
                let m = ((avail - w) / 2.0).max(16.0);
                ui.horizontal(|ui| {
                    ui.add_space(m);
                    ui.vertical(|ui| {
                        ui.set_width(w);
                        ui.add_space(26.0);
                        // 大标题
                        let mut job = egui::text::LayoutJob::default();
                        job.append(&title, 0.0, TextFormat {
                            font_id: FontId::new(27.0, theme::main_bold()),
                            color: pal.text,
                            line_height: Some(38.0),
                            valign: Align::Center,
                            ..Default::default()
                        });
                        job.wrap.max_width = w;
                        let g = ui.painter().layout_job(job);
                        let (r, _) = ui.allocate_exact_size(Vec2::new(w, g.size().y), Sense::hover());
                        ui.painter().galley(r.min, g, pal.text);

                        // 元信息行：板块徽标 + 标签 + 位置/时长
                        ui.add_space(10.0);
                        ui.horizontal(|ui| {
                            // 板块徽标
                            if !sec_name.is_empty() {
                                let sw = sec_name.chars().count() as f32 * 11.0 + 22.0;
                                let (cr, cr_resp) = ui.allocate_exact_size(
                                    Vec2::new(sw, 22.0),
                                    Sense::CLICK | Sense::HOVER,
                                );
                                ui.painter().rect_filled(
                                    cr,
                                    CornerRadius::same(11),
                                    tint(accent, pal.bg, 0.15),
                                );
                                ui.painter().text(
                                    cr.center(),
                                    egui::Align2::CENTER_CENTER,
                                    &sec_name,
                                    FontId::new(11.0, theme::main_semibold()),
                                    tint(accent, pal.bg, 0.95),
                                );
                                if cr_resp.hovered() {
                                    ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                                }
                                if cr_resp.clicked() {
                                    self.goto(View::Section(sec_id.clone()));
                                }
                                ui.add_space(2.0);
                            }
                            for t in &tags {
                                let tw = ui
                                    .painter()
                                    .layout_no_wrap(
                                        t.clone(),
                                        FontId::new(11.0, theme::mono_family()),
                                        tint(accent, pal.bg, 0.9),
                                    )
                                    .size()
                                    .x;
                                let (cr, _) = ui.allocate_exact_size(
                                    Vec2::new(tw + 16.0, 22.0),
                                    Sense::hover(),
                                );
                                ui.painter().rect_filled(
                                    cr,
                                    CornerRadius::same(11),
                                    tint(accent, pal.bg, 0.09),
                                );
                                ui.painter().text(
                                    cr.center(),
                                    egui::Align2::CENTER_CENTER,
                                    t,
                                    FontId::new(11.0, theme::mono_family()),
                                    tint(accent, pal.bg, 0.9),
                                );
                            }
                        });
                        if !idx_line.is_empty() {
                            ui.add_space(6.0);
                            paint_line(
                                ui,
                                &idx_line,
                                FontId::new(11.5, theme::mono_family()),
                                pal.text_faint,
                                18.0,
                            );
                        }
                        ui.add_space(12.0);
                        let (r, _) = ui.allocate_exact_size(Vec2::new(w, 1.0), Sense::hover());
                        ui.painter().rect_filled(r, 0, pal.border);
                        ui.add_space(14.0);

                        let env = Env {
                            pal,
                            accent,
                            scale: font_scale,
                            root: self.root.clone(),
                            base_dir,
                            content_width: w,
                        };
                        doc_out = Some(Renderer::render_doc(
                            ui,
                            &doc,
                            env,
                            &self.hl,
                            &mut self.code_cache,
                            &mut self.copied,
                        ));

                        // ---- 文末：上一篇 / 下一篇 ----
                        if prev_nav.is_some() || next_nav.is_some() {
                            ui.add_space(28.0);
                            let (r, _) = ui.allocate_exact_size(Vec2::new(w, 1.0), Sense::hover());
                            ui.painter().rect_filled(r, 0, pal.border);
                            ui.add_space(14.0);
                            paint_line(
                                ui,
                                "继续阅读",
                                FontId::new(11.0, theme::main_semibold()),
                                pal.text_faint,
                                22.0,
                            );
                            ui.add_space(2.0);
                            ui.horizontal(|ui| {
                                let cw = (w - 12.0) / 2.0;
                                self.nav_card(ui, cw, "← 上一篇", &prev_nav, accent, true);
                                ui.add_space(12.0);
                                self.nav_card(ui, cw, "下一篇 →", &next_nav, accent, false);
                            });
                        }
                    });
                });
                ui.add_space(46.0);
            });
        if let Some(result) = doc_out {
            self.heading_y = result.heading_y;
            for a in result.actions {
                match a {
                    Action::OpenArticle(rel) => self.goto(View::Article(rel)),
                    Action::OpenUrl(u) => self.pending_urls.push(u),
                }
            }
        }
        self.scroll_offset = out.state.offset.y;
    }

    /// 文末导航卡片（上一篇/下一篇）。
    fn nav_card(
        &mut self,
        ui: &mut Ui,
        w: f32,
        label: &str,
        target: &Option<(String, String)>,
        accent: Color32,
        align_left: bool,
    ) {
        let pal = self.pal();
        let h = 64.0;
        let (r, resp) = ui.allocate_exact_size(Vec2::new(w, h), Sense::CLICK | Sense::HOVER);
        if let Some((rel, title)) = target {
            if resp.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            ui.painter().rect_filled(
                r,
                CornerRadius::same(11),
                if resp.hovered() {
                    tint(pal.panel2, pal.bg, 0.95)
                } else {
                    tint(pal.panel2, pal.bg, 0.6)
                },
            );
            ui.painter().rect_stroke(
                r,
                CornerRadius::same(11),
                Stroke::new(
                    1.0,
                    if resp.hovered() {
                        tint(accent, pal.bg, 0.8)
                    } else {
                        pal.border
                    },
                ),
                egui::StrokeKind::Outside,
            );
            let anchor = if align_left {
                egui::Align2::LEFT_CENTER
            } else {
                egui::Align2::RIGHT_CENTER
            };
            let x = if align_left { r.left() + 14.0 } else { r.right() - 14.0 };
            ui.painter().text(
                Pos2::new(x, r.top() + 16.0),
                anchor,
                label,
                FontId::new(10.5, theme::mono_family()),
                pal.text_faint,
            );
            let mut job = egui::text::LayoutJob::default();
            job.append(title, 0.0, TextFormat {
                font_id: FontId::new(13.5, theme::main_semibold()),
                color: if resp.hovered() { tint(accent, pal.bg, 0.95) } else { pal.text },
                valign: Align::Center,
                ..Default::default()
            });
            job.wrap.max_width = w - 28.0;
            job.wrap.max_rows = 1;
            job.wrap.break_anywhere = true;
            let g = ui.painter().layout_job(job);
            ui.painter().galley(
                Pos2::new(x - g.size().x * if align_left { 0.0 } else { 1.0 },
                          r.bottom() - 16.0 - g.size().y / 2.0),
                g,
                pal.text,
            );
            if resp.clicked() {
                let rel = rel.clone();
                self.goto(View::Article(rel));
            }
        } else {
            // 无内容：淡占位
            ui.painter().rect_filled(r, CornerRadius::same(11), tint(pal.panel2, pal.bg, 0.3));
            ui.painter().rect_stroke(
                r,
                CornerRadius::same(11),
                Stroke::new(1.0, Color32::TRANSPARENT),
                egui::StrokeKind::Outside,
            );
        }
    }

    fn page_search(&mut self, ui: &mut Ui) {
        let pal = self.pal();
        let q = self.search.trim().to_lowercase();
        if self.last_search != self.search {
            self.last_search = self.search.clone();
            let results = compute_results(&self.lib, &q);
            self.search_results = results;
        }
        let results = self.search_results.clone();

        egui::ScrollArea::vertical()
            .auto_shrink(false)
            .id_salt("search")
            .show(ui, |ui| {
                let avail = ui.available_width();
                let w = 860.0f32.min(avail - 56.0);
                let m = ((avail - w) / 2.0).max(16.0);
                ui.add_space(32.0);
                ui.horizontal(|ui| {
                    ui.add_space(m);
                    ui.vertical(|ui| {
                        ui.set_width(w);
                        paint_line(
                            ui,
                            &format!("搜索 “{}”", q),
                            FontId::new(21.0, theme::main_bold()),
                            pal.text,
                            36.0,
                        );
                        let sub = if results.is_empty() {
                            "没有找到匹配的内容，换个关键词试试".to_string()
                        } else {
                            format!("{} 个结果", results.len())
                        };
                        paint_line(
                            ui,
                            &sub,
                            FontId::new(12.5, theme::mono_family()),
                            pal.text_faint,
                            26.0,
                        );
                        ui.add_space(10.0);

                        for hit in &results {
                            self.search_row(ui, w, hit, &q);
                            ui.add_space(6.0);
                        }
                    });
                });
                ui.add_space(40.0);
            });
    }

    fn search_row(&mut self, ui: &mut Ui, w: f32, hit: &SearchHit, q: &str) {
        let pal = self.pal();
        let h = 66.0;
        let (r, resp) = ui.allocate_exact_size(Vec2::new(w, h), Sense::CLICK | Sense::HOVER);
        if resp.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            ui.painter()
                .rect_filled(r, CornerRadius::same(9), tint(pal.panel2, pal.bg, 0.5));
        }
        // 板块徽标
        let chip_w = hit.sec_name.chars().count() as f32 * 9.0 + 22.0;
        let chip = Rect::from_min_size(
            r.left_top() + Vec2::new(10.0, 11.0),
            Vec2::new(chip_w, 18.0),
        );
        ui.painter()
            .rect_filled(chip, CornerRadius::same(9), tint(hit.accent, pal.bg, 0.14));
        ui.painter().text(
            chip.center(),
            egui::Align2::CENTER_CENTER,
            &hit.sec_name,
            FontId::new(10.5, theme::mono_family()),
            tint(hit.accent, pal.bg, 0.9),
        );
        ui.painter().text(
            Pos2::new(chip.right() + 10.0, r.top() + 20.0),
            egui::Align2::LEFT_CENTER,
            &hit.title,
            FontId::new(14.5, theme::main_semibold()),
            pal.text,
        );
        // 片段（高亮 q）
        let mut job = egui::text::LayoutJob::default();
        let schars: Vec<char> = hit.snippet.chars().collect();
        let lower_chars: Vec<char> = hit.snippet.to_lowercase().chars().collect();
        let q_chars: Vec<char> = q.chars().collect();
        let mut i = 0usize;
        while i < schars.len() {
            if lower_chars[i..].starts_with(&q_chars) && !q_chars.is_empty() {
                let n = q_chars.len();
                let seg: String = schars[i..i + n].iter().collect();
                job.append(&seg, 0.0, TextFormat {
                    font_id: FontId::new(12.0, theme::main_family()),
                    color: tint(hit.accent, pal.bg, 0.95),
                    line_height: Some(17.0),
                    valign: Align::Center,
                    ..Default::default()
                });
                i += n;
            } else {
                let seg: String = schars[i..i + 1].iter().collect();
                job.append(&seg, 0.0, TextFormat {
                    font_id: FontId::new(12.0, theme::main_family()),
                    color: pal.text_dim,
                    line_height: Some(17.0),
                    valign: Align::Center,
                    ..Default::default()
                });
                i += 1;
            }
        }
        job.wrap.max_width = w - 24.0;
        job.wrap.max_rows = 2;
        let g = ui.painter().layout_job(job);
        ui.painter().galley(Pos2::new(r.left() + 12.0, r.top() + 34.0), g, pal.text_dim);
        if resp.clicked() {
            let rel = hit.rel.clone();
            self.search.clear();
            self.goto(View::Article(rel));
        }
    }
}

fn compute_results(lib: &Library, q: &str) -> Vec<SearchHit> {
    let mut out = Vec::new();
    if q.is_empty() {
        return out;
    }
    for (sec, art) in lib.all_articles() {
        let hay = art.plain.to_lowercase();
        let mut score = hay.matches(q).count();
        if art.title.to_lowercase().contains(q) {
            score += 100;
        }
        if score == 0 {
            continue;
        }
        // 片段：按字符切，避免切断 UTF-8
        let chars: Vec<char> = art.plain.chars().collect();
        let lower_chars: Vec<char> = hay.chars().collect();
        let qn = q.chars().count();
        let mut char_idx = lower_chars
            .windows(qn.max(1).min(lower_chars.len().max(1)))
            .position(|w| w.iter().collect::<String>() == q)
            .unwrap_or(0);
        if score > hay.matches(q).count() {
            char_idx = 0; // 标题命中，直接展示开头
        }
        let start = char_idx.saturating_sub(30);
        let end = (char_idx + qn + 50).min(chars.len());
        let mut snippet: String = chars[start..end].iter().collect();
        if start > 0 {
            snippet.insert(0, '…');
        }
        if end < chars.len() {
            snippet.push('…');
        }
        out.push(SearchHit {
            sec_name: sec.meta.name.to_string(),
            accent: sec.meta.accent,
            title: art.title.clone(),
            rel: art.rel.clone(),
            score,
            snippet: snippet.replace('\n', " "),
        });
    }
    out.sort_by(|a, b| b.score.cmp(&a.score));
    out.truncate(60);
    out
}

fn empty_state(ui: &mut Ui, w: f32, name: &str, accent: Color32, pal: &Palette, root: &Path) {
    ui.vertical_centered(|ui| {
        ui.set_width(w);
        ui.add_space(16.0);
        let mo = Rect::from_min_size(
            Pos2::new(w / 2.0 - 32.0, ui.cursor().top() + 8.0),
            Vec2::new(64.0, 64.0),
        );
        ui.allocate_exact_size(Vec2::new(w, 80.0), Sense::hover());
        ui.painter()
            .rect_filled(mo, CornerRadius::same(16), tint(accent, pal.bg, 0.12));
        ui.painter().text(
            mo.center(),
            egui::Align2::CENTER_CENTER,
            "··",
            FontId::new(22.0, theme::main_bold()),
            tint(accent, pal.bg, 0.5),
        );
        ui.add_space(4.0);
        paint_line_center(
            ui,
            w,
            &format!("{name} 板块正在筹备中"),
            FontId::new(15.0, theme::main_semibold()),
            pal.text_dim,
            32.0,
        );
        paint_line_center(
            ui,
            w,
            "把 .md 文件放进 knowledge/ 对应目录，内容会自动出现在这里",
            FontId::new(12.5, theme::main_family()),
            pal.text_faint,
            30.0,
        );
        ui.add_space(4.0);
        if ui
            .add(
                egui::Button::new(
                    egui::RichText::new("打开内容目录")
                        .font(FontId::new(12.5, theme::main_semibold())),
                )
                .corner_radius(CornerRadius::same(7)),
            )
            .clicked()
        {
            open_dir(root);
        }
        ui.add_space(10.0);
    });
}

fn open_dir(p: &Path) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(p).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(p).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(p).spawn();
    }
}

// ---------- 小工具 ----------

fn tint(c: Color32, bg: Color32, a: f32) -> Color32 {
    theme::tint_over(c, bg, a)
}

/// 顶栏面包屑。
fn crumb(ui: &mut Ui, text: &str, current: bool, pal: &Palette) -> egui::Response {
    let g = ui.painter().layout_no_wrap(
        text.to_string(),
        FontId::new(
            13.0,
            if current { theme::main_semibold() } else { theme::main_family() },
        ),
        if current { pal.text } else { pal.text_dim },
    );
    let (r, resp) = ui.allocate_exact_size(Vec2::new(g.size().x + 8.0, 46.0), Sense::click());
    if resp.hovered() && !current {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    let color = if resp.hovered() && !current {
        pal.text
    } else if current {
        pal.text
    } else {
        pal.text_dim
    };
    let g = ui.painter().layout_no_wrap(
        text.to_string(),
        FontId::new(
            13.0,
            if current { theme::main_semibold() } else { theme::main_family() },
        ),
        color,
    );
    ui.painter().galley(
        Pos2::new(r.min.x + 4.0, r.center().y - g.size().y / 2.0),
        g,
        color,
    );
    resp
}

fn crumb_sep(ui: &mut Ui, pal: &Palette) {
    let (r, _) = ui.allocate_exact_size(Vec2::new(14.0, 46.0), Sense::hover());
    ui.painter().text(
        r.center(),
        egui::Align2::CENTER_CENTER,
        "›",
        FontId::new(13.0, theme::main_family()),
        pal.text_faint,
    );
}

fn icon_btn(ui: &mut Ui, text: &str, pal: &Palette) -> egui::Response {
    let probe = ui
        .painter()
        .layout_no_wrap(text.to_string(), FontId::new(12.0, theme::main_family()), pal.text_dim);
    let (r, resp) = ui.allocate_exact_size(
        Vec2::new(probe.size().x + 20.0, 28.0),
        Sense::CLICK | Sense::HOVER,
    );
    if resp.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    // pill 外形：边框 + 微底色
    ui.painter().rect_filled(
        r,
        CornerRadius::same(9),
        if resp.hovered() {
            tint(pal.panel2, pal.bg, 0.95)
        } else {
            Color32::TRANSPARENT
        },
    );
    ui.painter().rect_stroke(
        r,
        CornerRadius::same(9),
        Stroke::new(
            1.0,
            if resp.hovered() {
                tint(pal.text_dim, pal.bg, 0.45)
            } else {
                pal.border
            },
        ),
        egui::StrokeKind::Outside,
    );
    let color = if resp.hovered() { pal.text } else { pal.text_dim };
    let g = ui
        .painter()
        .layout_no_wrap(text.to_string(), FontId::new(12.0, theme::main_family()), color);
    ui.painter().galley(
        Pos2::new(r.center().x - g.size().x / 2.0, r.center().y - g.size().y / 2.0),
        g,
        color,
    );
    resp
}

/// 画一行文本并占据对应高度（顶部对齐）。
fn paint_line(ui: &mut Ui, text: &str, font: FontId, color: Color32, height: f32) {
    let mut job = egui::text::LayoutJob::default();
    job.append(text, 0.0, TextFormat {
        font_id: font,
        color,
        valign: Align::Center,
        ..Default::default()
    });
    job.wrap.max_width = ui.available_width();
    let g = ui.painter().layout_job(job);
    let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    ui.painter().galley(Pos2::new(r.min.x, r.center().y - g.size().y / 2.0), g, color);
}

fn paint_line_center(
    ui: &mut Ui,
    w: f32,
    text: &str,
    font: FontId,
    color: Color32,
    height: f32,
) {
    let mut job = egui::text::LayoutJob::default();
    job.append(text, 0.0, TextFormat {
        font_id: font,
        color,
        valign: Align::Center,
        ..Default::default()
    });
    job.wrap.max_width = w;
    let g = ui.painter().layout_job(job);
    let (r, _) = ui.allocate_exact_size(Vec2::new(w, height), Sense::hover());
    ui.painter().galley(
        Pos2::new(r.center().x - g.size().x / 2.0, r.center().y - g.size().y / 2.0),
        g,
        color,
    );
}
