//! Knowledge Vault —— 本地知识库（Rust + egui）。

mod app;
mod content;
mod highlight;
mod markdown;
mod render;
mod theme;

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1400.0, 900.0])
            .with_min_inner_size([1020.0, 640.0])
            .with_title("Knowledge Vault · 知识库"),
        ..Default::default()
    };
    eframe::run_native(
        "Knowledge Vault",
        options,
        Box::new(|cc| Ok(Box::new(app::App::new(cc)))),
    )
}
