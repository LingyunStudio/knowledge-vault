//! 文件监听：notify 递归监听 + 400ms 去抖，事件经 `library-changed` 推给前端；
//! 创建失败时退化为 2s 指纹轮询（与旧 egui 版行为一致）。

use notify::RecursiveMode;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::library::scan_fingerprint;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChangedFile {
    /// 相对 root 的 POSIX 路径
    rel: String,
    /// debouncer 事件统一标记为 any
    kind: String,
}

/// 不透明持有，保持 watcher / 轮询线程存活。
pub enum WatchGuard {
    Debouncer(notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>),
    Polling(PollingGuard),
}

/// 轮询线程守卫：drop 时置位停止标记，线程在至多 2 秒内退出。
pub struct PollingGuard {
    stop: Arc<AtomicBool>,
}

impl Drop for PollingGuard {
    fn drop(&mut self) { self.stop.store(true, Ordering::Relaxed); }
}

/// 启动监听；任何失败都静默降级为轮询，不阻塞应用启动。
pub fn start(app: AppHandle, root: PathBuf) -> WatchGuard {
    match start_debouncer(app.clone(), root.clone()) {
        Ok(deb) => WatchGuard::Debouncer(deb),
        Err(e) => {
            eprintln!("文件监听不可用，退化为轮询: {e}");
            WatchGuard::Polling(start_polling(app, root))
        }
    }
}

fn start_debouncer(
    app: AppHandle,
    root: PathBuf,
) -> notify::Result<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>> {
    let root_for_cb = root.clone();
    let mut debouncer = notify_debouncer_mini::new_debouncer(
        Duration::from_millis(400),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            let Ok(events) = res else {
                return;
            };
            let mut changed: Vec<ChangedFile> = events
                .iter()
                .filter_map(|ev| {
                    // 忽略隐藏文件/临时文件（含可写性探测）
                    let name = ev
                        .path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if name.starts_with('.') || name.ends_with('~') {
                        return None;
                    }
                    rel_of(&root_for_cb, &ev.path).map(|r| ChangedFile {
                        rel: r,
                        kind: "any".to_string(),
                    })
                })
                .collect();
            dedup(&mut changed);
            if !changed.is_empty() {
                let _ = app.emit("library-changed", changed);
            }
        },
    )?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

fn start_polling(app: AppHandle, root: PathBuf) -> PollingGuard {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    std::thread::spawn(move || {
        let mut last = scan_fingerprint(&root);
        loop {
            // 分片睡眠：既保持 2s 轮询节奏，又能及时响应停止标记（知识库切换时）。
            for _ in 0..10 {
                if stop_flag.load(Ordering::Relaxed) { return; }
                std::thread::sleep(Duration::from_millis(200));
            }
            if stop_flag.load(Ordering::Relaxed) { return; }
            let now = scan_fingerprint(&root);
            if now != last {
                last = now;
                // 轮询拿不到具体文件，空数组通知前端全量重扫
                let _ = app.emit("library-changed", Vec::<ChangedFile>::new());
            }
        }
    });
    PollingGuard { stop }
}

fn rel_of(root: &Path, p: &Path) -> Option<String> {
    p.strip_prefix(root)
        .ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
}

fn dedup(items: &mut Vec<ChangedFile>) {
    let mut seen = std::collections::HashSet::new();
    items.retain(|c| seen.insert(c.rel.clone()));
}
