mod ai;
mod backup;
mod commands;
mod credentials;
mod library;
mod safe_path;
mod storage;
mod vault;
#[cfg(test)]
mod vault_tests;
mod kvstore;
mod links;
mod root;
mod upload_command;
mod updater;
mod watcher;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use root::RootInfo;
use watcher::WatchGuard;

/// 应用共享状态：知识库根路径、根信息、文件监听句柄、AI 流中断标记。
/// library_io 串行化全部库写入命令（保存/删除/恢复/元数据/移动）。
pub struct AppState {
    pub root: Mutex<PathBuf>,
    pub root_info: Mutex<RootInfo>,
    pub watcher: Mutex<Option<WatchGuard>>,
    pub ai_aborts: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub library_io: Mutex<()>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            root: Mutex::new(PathBuf::new()),
            root_info: Mutex::new(RootInfo {
                path: String::new(),
                source: "uninit".into(),
                writable: false,
            }),
            watcher: Mutex::new(None),
            ai_aborts: Mutex::new(HashMap::new()),
            library_io: Mutex::new(()),
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
            commands::update_section,
            commands::reorder_sections,
            commands::delete_article,
            commands::purge_trash,
            commands::list_trash,
            commands::restore_trash,
            commands::list_article_history,
            commands::read_article_history,
            commands::restore_article_history,
            commands::update_article_metadata,
            commands::move_article,
            commands::list_article_links,
            ai::ai_chat,
            ai::ai_abort,
            ai::ai_list_models,
            ai::ai_image,
            backup::create_backup,
            backup::list_backups,
            backup::restore_backup,
            storage::storage_settings,
            storage::set_knowledge_root,
            storage::set_backups_dir,
            updater::check_update,
            updater::download_and_install,
            updater::app_version,
            credentials::credential_set,
            credentials::credential_get,
            credentials::credential_delete,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
