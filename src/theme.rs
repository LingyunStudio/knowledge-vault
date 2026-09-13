//! 配色、字体与全局样式。

use egui::{
    Color32, Context, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Style, Theme,
    Vec2,
};
use std::path::PathBuf;
/// 一套完整配色。
#[derive(Clone, Copy)]
pub struct Palette {
    pub bg: Color32,
    pub panel: Color32,
    pub panel2: Color32,
    pub border: Color32,
    pub text: Color32,
    pub text_dim: Color32,
    pub text_faint: Color32,
    pub accent: Color32,
    pub selection: Color32,
    pub code_bg: Color32,
    pub code_border: Color32,
    pub inline_code_bg: Color32,
    pub inline_code_fg: Color32,
    pub quote_bg: Color32,
    pub callouts: [Color32; 5],
}

pub const CALLOUT_NAMES: [&str; 5] = ["提示", "小贴士", "重要", "注意", "警告"];

pub const DARK: Palette = Palette {
    bg: Color32::from_rgb(0x12, 0x14, 0x19),
    panel: Color32::from_rgb(0x18, 0x1B, 0x21),
    panel2: Color32::from_rgb(0x1D, 0x21, 0x28),
    border: Color32::from_rgb(0x26, 0x2B, 0x34),
    text: Color32::from_rgb(0xE3, 0xE6, 0xEA),
    text_dim: Color32::from_rgb(0x9B, 0xA3, 0xAE),
    text_faint: Color32::from_rgb(0x6A, 0x72, 0x80),
    accent: Color32::from_rgb(0x8B, 0x93, 0xF8),
    selection: Color32::from_rgb(0x2A, 0x31, 0x40),
    code_bg: Color32::from_rgb(0x16, 0x1A, 0x22),
    code_border: Color32::from_rgb(0x23, 0x29, 0x36),
    inline_code_bg: Color32::from_rgb(0x20, 0x26, 0x31),
    inline_code_fg: Color32::from_rgb(0xEC, 0x9A, 0x74),
    quote_bg: Color32::from_rgb(0x16, 0x19, 0x1F),
    callouts: [
        Color32::from_rgb(0x6C, 0xA9, 0xE8),
        Color32::from_rgb(0x5B, 0xC0, 0x8E),
        Color32::from_rgb(0xA9, 0x8B, 0xF0),
        Color32::from_rgb(0xE2, 0xA3, 0x4E),
        Color32::from_rgb(0xEC, 0x74, 0x74),
    ],
};

pub const LIGHT: Palette = Palette {
    bg: Color32::from_rgb(0xFB, 0xFA, 0xF7),
    panel: Color32::from_rgb(0xF2, 0xF0, 0xEB),
    panel2: Color32::from_rgb(0xFF, 0xFF, 0xFF),
    border: Color32::from_rgb(0xE4, 0xE1, 0xD9),
    text: Color32::from_rgb(0x26, 0x29, 0x2F),
    text_dim: Color32::from_rgb(0x6C, 0x72, 0x7C),
    text_faint: Color32::from_rgb(0xA0, 0xA5, 0xAD),
    accent: Color32::from_rgb(0x5E, 0x6A, 0xEE),
    selection: Color32::from_rgb(0xE2, 0xE5, 0xFB),
    code_bg: Color32::from_rgb(0x16, 0x1A, 0x22),
    code_border: Color32::from_rgb(0x23, 0x29, 0x36),
    inline_code_bg: Color32::from_rgb(0xEC, 0xE9, 0xE0),
    inline_code_fg: Color32::from_rgb(0x9C, 0x3D, 0x10),
    quote_bg: Color32::from_rgb(0xF4, 0xF2, 0xEC),
    callouts: [
        Color32::from_rgb(0x2E, 0x71, 0xB8),
        Color32::from_rgb(0x27, 0x8F, 0x5E),
        Color32::from_rgb(0x76, 0x52, 0xC8),
        Color32::from_rgb(0xB5, 0x74, 0x14),
        Color32::from_rgb(0xC5, 0x39, 0x39),
    ],
};

/// 板块的专属强调色与元信息。
pub struct SectionMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub glyph: &'static str,
    pub desc: &'static str,
    pub accent: Color32,
}

pub const SECTIONS: [SectionMeta; 6] = [
    SectionMeta { id: "c", name: "C", glyph: "C", desc: "系统编程的基石：指针、内存与贴近硬件的力量", accent: Color32::from_rgb(0x5B, 0x9B, 0xD5) },
    SectionMeta { id: "python", name: "Python", glyph: "Py", desc: "简洁而强大的胶水语言：脚本、数据与自动化", accent: Color32::from_rgb(0x4B, 0x8B, 0xBE) },
    SectionMeta { id: "git", name: "Git", glyph: "Git", desc: "版本控制与协作之道：提交、分支与历史", accent: Color32::from_rgb(0xF0, 0x51, 0x33) },
    SectionMeta { id: "matlab", name: "MATLAB", glyph: "M", desc: "数值计算与工程仿真：矩阵、建模与可视化", accent: Color32::from_rgb(0xE5, 0x6D, 0x2C) },
    SectionMeta { id: "rust", name: "Rust", glyph: "Rs", desc: "内存安全与无畏并发：所有权、借用与生命周期", accent: Color32::from_rgb(0xE8, 0x82, 0x5A) },
    SectionMeta { id: "ai", name: "AI", glyph: "AI", desc: "机器学习与深度学习：从原理到工程实践", accent: Color32::from_rgb(0x9B, 0x7B, 0xF3) },
];

/// 未知板块的默认外观。
#[allow(dead_code)]
pub fn fallback_meta(id: &str) -> SectionMeta {
    let g: String = id.chars().take(2).collect();
    SectionMeta {
        id: "",
        name: "",
        glyph: Box::leak(g.into_boxed_str()),
        desc: "",
        accent: Color32::from_rgb(0x8B, 0x93, 0xF8),
    }
}

/// 加载系统字体并注册自定义字体族。
///
/// 全部族都做了 CJK 回退：拉丁字符用西文字体，中文落到微软雅黑。
pub fn load_fonts(ctx: &Context) {
    let mut defs = FontDefinitions::default();
    let dir = PathBuf::from(r"C:\Windows\Fonts");
    let fonts_dir = std::env::var("WINDIR")
        .map(|w| PathBuf::from(w).join("Fonts"))
        .unwrap_or(dir.clone());
    let dir = fonts_dir;

    let load = |file: &str| -> Option<FontData> {
        std::fs::read(dir.join(file))
            .ok()
            .map(|bytes| FontData {
                font: bytes.into(),
                index: 0,
                tweak: Default::default(),
            })
            .or_else(|| {
                eprintln!("字体缺失: {file}");
                None
            })
    };

    let seg = load("segoeui.ttf");
    let seg_b = load("segoeuib.ttf");
    let seg_sb = load("seguisb.ttf");
    let seg_i = load("segoeuii.ttf");
    let con = load("consola.ttf");
    let con_b = load("consolab.ttf");
    let ya = load("msyh.ttc");
    let ya_b = load("msyhbd.ttc");

    for (k, v) in [
        ("seg", seg), ("seg-b", seg_b), ("seg-sb", seg_sb), ("seg-i", seg_i),
        ("con", con), ("con-b", con_b), ("ya", ya), ("ya-b", ya_b),
    ] {
        if let Some(d) = v {
            defs.font_data.insert(k.to_string(), std::sync::Arc::new(d));
        }
    }

    let default_prop = defs
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();
    let default_mono = defs
        .families
        .get(&FontFamily::Monospace)
        .cloned()
        .unwrap_or_default();

    let fam = |defs: &mut FontDefinitions, name: &str, keys: Vec<&str>, fallback: &[String]| {
        let list: Vec<String> = keys
            .into_iter()
            .filter(|k| defs.font_data.contains_key(*k))
            .map(|k| k.to_string())
            .collect();
        defs.families.insert(
            FontFamily::Name(name.into()),
            if list.is_empty() { fallback.to_vec() } else { list },
        );
    };

    fam(&mut defs, "main", vec!["seg", "ya"], &default_prop);
    fam(&mut defs, "main-b", vec!["seg-b", "ya-b"], &default_prop);
    fam(&mut defs, "main-sb", vec!["seg-sb", "ya-b"], &default_prop);
    fam(&mut defs, "main-i", vec!["seg-i", "ya"], &default_prop);
    fam(&mut defs, "mono", vec!["con", "ya"], &default_mono);
    fam(&mut defs, "mono-b", vec!["con-b", "ya-b"], &default_mono);

    ctx.set_fonts(defs);
}

pub fn main_family() -> FontFamily {
    FontFamily::Name("main".into())
}
pub fn main_bold() -> FontFamily {
    FontFamily::Name("main-b".into())
}
pub fn main_semibold() -> FontFamily {
    FontFamily::Name("main-sb".into())
}
pub fn main_italic() -> FontFamily {
    FontFamily::Name("main-i".into())
}
pub fn mono_family() -> FontFamily {
    FontFamily::Name("mono".into())
}

/// 把两套主题的 style 都定制好（切换时只调 `ctx.set_theme`）。
pub fn install_styles(ctx: &Context) {
    for (theme, pal) in [(Theme::Dark, &DARK), (Theme::Light, &LIGHT)] {
        ctx.style_mut_of(theme, |s| apply_palette(s, pal));
    }
}

fn apply_palette(s: &mut Style, pal: &Palette) {
    let v = &mut s.visuals;
    v.panel_fill = pal.panel;
    v.window_fill = pal.bg;
    v.extreme_bg_color = pal.code_bg;
    v.override_text_color = Some(pal.text);
    v.selection.bg_fill = pal.selection;
    v.selection.stroke = egui::Stroke::NONE;
    v.hyperlink_color = pal.accent;
    v.widgets.noninteractive.bg_fill = pal.panel2;
    v.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, pal.text_dim);
    v.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, pal.border);
    v.widgets.inactive.bg_fill = pal.panel2;
    v.widgets.inactive.fg_stroke = egui::Stroke::new(1.0, pal.text_dim);
    v.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, pal.border);
    v.widgets.hovered.bg_fill = pal.panel2;
    v.widgets.hovered.fg_stroke = egui::Stroke::new(1.0, pal.text);
    v.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, pal.border);
    v.widgets.active.bg_fill = pal.selection;
    v.widgets.active.fg_stroke = egui::Stroke::new(1.0, pal.text);
    v.window_corner_radius = CornerRadius::same(10);
    v.menu_corner_radius = CornerRadius::same(8);
    v.window_stroke = egui::Stroke::new(1.0, pal.border);
    s.spacing.item_spacing = Vec2::new(8.0, 8.0);
    s.spacing.button_padding = Vec2::new(10.0, 5.0);
    s.spacing.menu_margin = egui::Margin::same(6);
    s.text_styles = [
        (egui::TextStyle::Body, FontId::new(15.0, main_family())),
        (egui::TextStyle::Button, FontId::new(13.0, main_semibold())),
        (egui::TextStyle::Heading, FontId::new(20.0, main_bold())),
        (egui::TextStyle::Small, FontId::new(11.5, main_family())),
        (egui::TextStyle::Monospace, FontId::new(13.0, mono_family())),
    ]
    .into();
}

/// 颜色叠加到背景上（用于半透明的强调底色）。
pub fn tint_over(c: Color32, bg: Color32, a: f32) -> Color32 {
    let mix = |x: u8, y: u8| (x as f32 * a + y as f32 * (1.0 - a)).round() as u8;
    Color32::from_rgb(mix(c.r(), bg.r()), mix(c.g(), bg.g()), mix(c.b(), bg.b()))
}
