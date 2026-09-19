//! GitHub Release 自动更新（仅 release 构建生效；debug 下检查恒为空，避免开发态误装）。
//! 流程：check_update 对比 GitHub latest 与当前版本 → 前端确认后 download_and_install
//! 流式下载安装包（进度经 update-download-progress 事件推送）→ 以 /SILENT
//! /CLOSEAPPLICATIONS 运行 Inno 安装器 → 应用退出让出 exe；安装完成后由安装器
//! 的「立即运行」条目启动新版本（installer.iss 中该条目不带 skipifsilent）。

use tauri::AppHandle;

type Result<T> = std::result::Result<T, String>;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub release_url: String,
    pub asset_name: String,
    /// Release notes 正文（GitHub Release body，Markdown）
    pub notes: String,
}

/// 当前应用版本号（设置界面「关于」展示用）。
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>> {
    #[cfg(debug_assertions)]
    let _ = &app;
    #[cfg(debug_assertions)]
    return Ok(None);
    #[cfg(not(debug_assertions))]
    return imp::check_update(app).await;
}

#[tauri::command]
pub async fn download_and_install(app: AppHandle) -> Result<()> {
    #[cfg(debug_assertions)]
    let _ = &app;
    #[cfg(debug_assertions)]
    return Err("开发模式下不支持自动更新".into());
    #[cfg(not(debug_assertions))]
    return imp::download_and_install(app).await;
}

#[cfg(not(debug_assertions))]
mod imp {
    use super::{UpdateInfo, Result};
    use serde_json::Value;
    use std::io::Write;
    use std::sync::atomic::AtomicBool;
    use tauri::{AppHandle, Emitter, Manager};

    const RELEASE_API: &str = "https://api.github.com/repos/LingyunStudio/knowledge-vault/releases/latest";
    static DOWNLOAD_IN_PROGRESS: AtomicBool = AtomicBool::new(false);


    #[derive(serde::Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct Progress { received: u64, total: u64 }

    fn client() -> Result<reqwest::Client> {
        reqwest::Client::builder()
            .user_agent("yunyu-updater")
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())
    }

    async fn fetch_latest(client: &reqwest::Client) -> Result<Value> {
        let response = client
            .get(RELEASE_API)
            .header("Accept", "application/vnd.github+json")
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("无法连接 GitHub：{e}"))?;
        if !response.status().is_success() {
            return Err(format!("GitHub API 返回 {}", response.status()));
        }
        response.json().await.map_err(|e| e.to_string())
    }

    /// 从 release 中挑出 x64 安装包，返回 (名称, 下载地址, 字节数)
    fn pick_asset(release: &Value) -> Result<(String, String, u64)> {
        let assets = release.get("assets").and_then(Value::as_array).ok_or("响应缺少 assets")?;
        for asset in assets {
            let name = asset.get("name").and_then(Value::as_str).unwrap_or("");
            if name.ends_with("-x64-setup.exe") {
                let url = asset.get("browser_download_url").and_then(Value::as_str)
                    .ok_or("资产缺少下载地址")?;
                let size = asset.get("size").and_then(Value::as_u64).unwrap_or(0);
                return Ok((name.to_string(), url.to_string(), size));
            }
        }
        Err("最新 Release 未找到 x64 安装包".into())
    }

    /// 版本比较：逐段数值比较（v0.2.0 > 0.1.9），段数不齐按 0 补齐
    fn is_newer(latest: &str, current: &str) -> bool {
        let part = |v: &str| -> Vec<u64> {
            v.trim().trim_start_matches('v').split('.')
                .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0))
                .collect()
        };
        let (latest, current) = (part(latest), part(current));
        for i in 0..latest.len().max(current.len()) {
            let (l, c) = (
                latest.get(i).copied().unwrap_or(0),
                current.get(i).copied().unwrap_or(0),
            );
            if l != c { return l > c; }
        }
        false
    }

    /// 当前是按用户安装（exe 位于 %LOCALAPPDATA%\Programs 下）时，更新也走当前用户模式，避免弹 UAC
    fn per_user_install(app: &AppHandle) -> bool {
        match (app.path().local_data_dir(), std::env::current_exe()) {
            (Ok(base), Ok(exe)) => exe.starts_with(base.join("Programs")),
            _ => false,
        }
    }

    pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>> {
        let client = client()?;
        let release = fetch_latest(&client).await?;
        let latest = release.get("tag_name").and_then(Value::as_str).unwrap_or("").to_string();
        let current = app.package_info().version.to_string();
        if latest.is_empty() || !is_newer(&latest, &current) {
            return Ok(None);
        }
        let (asset_name, _, _) = pick_asset(&release)?;
        Ok(Some(UpdateInfo {
            current,
            latest: latest.trim_start_matches('v').to_string(),
            release_url: release.get("html_url").and_then(Value::as_str).unwrap_or("").to_string(),
            asset_name,
            notes: release.get("body").and_then(Value::as_str).unwrap_or("").to_string(),
        }))
    }

    pub async fn download_and_install(app: AppHandle) -> Result<()> {
        // 提示条与设置「关于」都可能触发，防止并发重复下载/重复拉起安装器
        if DOWNLOAD_IN_PROGRESS.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Err("已有一次更新下载正在进行。".into());
        }
        let result = perform(&app).await;
        if result.is_err() {
            // 失败时复位允许重试；成功路径不再复位——应用即将退出
            DOWNLOAD_IN_PROGRESS.store(false, std::sync::atomic::Ordering::SeqCst);
        }
        result
    }

    async fn perform(app: &AppHandle) -> Result<()> {
        let client = client()?;
        let release = fetch_latest(&client).await?;
        let latest = release.get("tag_name").and_then(Value::as_str).unwrap_or("");
        let current = app.package_info().version.to_string();
        if !is_newer(latest, &current) {
            return Err("当前已是最新版本。".into());
        }
        let (_, url, size) = pick_asset(&release)?;

        // 下载到临时目录（文件名带版本号，避免与旧文件冲突）；进度每跨 1 MiB 推送一次
        let target = std::env::temp_dir()
            .join(format!("Yunyu-update-{}-setup.exe", latest.trim_start_matches('v')));
        let _ = std::fs::remove_file(&target);
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(900))
            .send()
            .await
            .map_err(|e| format!("下载失败：{e}"))?;
        if !response.status().is_success() {
            return Err(format!("下载失败：GitHub 返回 {}", response.status()));
        }
        let total = response.content_length().unwrap_or(size);
        let mut received: u64 = 0;
        let mut last_mb: u64 = 0;
        {
            // 独立作用域：写完立即关闭句柄，否则 spawn 时文件仍被本进程占用（os error 32）
            let mut file = std::fs::File::create(&target).map_err(|e| e.to_string())?;
            let mut response = response;
            loop {
                let chunk = response.chunk().await.map_err(|e| e.to_string())?;
                let Some(bytes) = chunk else { break };
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                received += bytes.len() as u64;
                if received / (1024 * 1024) != last_mb {
                    last_mb = received / (1024 * 1024);
                    let _ = app.emit("update-download-progress", Progress { received, total });
                }
            }
            file.sync_all().map_err(|e| e.to_string())?;
        }
        if total > 0 && received != total {
            let _ = std::fs::remove_file(&target);
            return Err(format!("下载不完整：{received} / {total} 字节"));
        }
        let _ = app.emit("update-download-progress", Progress { received, total });

        // 启动安装器：静默安装 + 关闭占用 exe 的应用；随后本应用退出，
        // 安装完成后的「立即运行」条目会打开新版本。
        // 新落盘的 exe 可能被杀毒/索引器短暂占用（os error 32），重试启动。
        let mut installer = std::process::Command::new(&target);
        installer.arg("/SILENT").arg("/CLOSEAPPLICATIONS").arg("/SUPPRESSMSGBOXES");
        if per_user_install(&app) {
            installer.arg("/CURRENTUSER");
        }
        let mut last_err: Option<std::io::Error> = None;
        for _ in 0..10 {
            match installer.spawn() {
                Ok(_) => { last_err = None; break; }
                Err(e) if e.raw_os_error() == Some(32) => {
                    last_err = Some(e);
                    std::thread::sleep(std::time::Duration::from_millis(400));
                }
                Err(e) => { last_err = Some(e); break; }
            }
        }
        if let Some(e) = last_err {
            let _ = std::fs::remove_file(&target);
            return Err(format!("启动安装器失败：{e}。安装包已保留在 %TEMP%，可手动运行。"));
        }

        let app_for_exit = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(600));
            app_for_exit.exit(0);
        });
        Ok(())
    }
}
