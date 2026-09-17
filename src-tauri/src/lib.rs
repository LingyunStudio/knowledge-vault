mod ai;
mod commands;
mod library;
mod root;
mod upload_command;
mod watcher;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use root::RootInfo;
use watcher::WatchGuard;

/// 应用共享状态：知识库根路径、根信息、文件监听句柄、AI 流中断标记。
pub struct AppState {
    pub root: Mutex<PathBuf>,
    pub root_info: Mutex<RootInfo>,
    pub watcher: Mutex<Option<WatchGuard>>,
    pub ai_aborts: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            root: Mutex::new(PathBuf::new()),
            root_info: Mutex::new(RootInfo {
                path: String::new(),
                source: "uninit".into(),
                writable: false,
            }),
            watcher: Mutex::new(None),
            ai_aborts: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            let (root, info) = root::locate(app.handle());
            println!("knowledge root: {} ({})", info.path, info.source);
            *app.state::<AppState>().root.lock().unwrap() = root.clone();
            *app.state::<AppState>().root_info.lock().unwrap() = info;
            // 必须存进 state，setup 返回后 watcher 不能被 drop
            let guard = watcher::start(app.handle().clone(), root);
            *app.state::<AppState>().watcher.lock().unwrap() = Some(guard);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_root,
            commands::scan_library,
            commands::read_article,
            commands::write_article,
            commands::read_logo,
            commands::read_cover,
            commands::save_paste_image,
            commands::run_upload_command,
            commands::read_image,
            commands::create_article,
            commands::create_section,
            commands::delete_article,
            ai::ai_chat,
            ai::ai_abort,
            ai::ai_list_models,
            ai::ai_image,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
