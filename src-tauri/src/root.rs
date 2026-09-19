//! knowledge 目录定位：
//! 环境变量 → 用户显式配置 → dev 源码目录（debug）→ 已保存配置（自动写入）→
//! exe 祖先 → cwd 邻近 → 打包资源（首运行拷贝到可写目录）。
//! 用户在设置中显式选择的位置（root_explicit）必须始终生效，包括 dev 构建；
//! 资源拷贝等自动写入的 root 在 dev 下仍让位于源码目录。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::safe_path;
use crate::storage::{read_config, write_config};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub path: String,
    /// 命中来源：env | config | dev-source | ancestor | cwd | resource-copy | fallback
    pub source: String,
    pub writable: bool,
}

/// 定位知识库根目录，并在需要时完成资源拷贝。
pub fn locate(app: &AppHandle) -> (PathBuf, RootInfo) {
    let data_dir = app.path().app_local_data_dir().ok();
    let config = read_config(app);
    let saved_root = config.root.clone().map(PathBuf::from);

    // 1. 环境变量
    if let Ok(p) = std::env::var("KNOWLEDGE_VAULT_ROOT") {
        let p = PathBuf::from(p);
        if looks_like_root(&p) {
            return info(p, "env");
        }
    }

    // 2. 用户显式配置：始终生效（dev 构建也不例外），找不到时命令侧会报错
    if config.root_explicit {
        if let Some(p) = saved_root {
            return info(p, "config");
        }
    }

    // 3. dev 构建：直接使用仓库内 knowledge，避免编辑 exe 旁的资源副本（target/ 下）
    #[cfg(debug_assertions)]
    {
        let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../knowledge");
        if looks_like_root(&dev_root) {
            return info(dev_root, "dev-source");
        }
    }

    // 4. 已保存配置（资源拷贝等自动写入的）
    if let Some(p) = saved_root {
        if looks_like_root(&p) {
            return info(p, "config");
        }
    }

    // 5. exe 祖先（dev 下 src-tauri/target/debug → 工程根；便携版 = exe 旁）
    //    只读（如安装到 Program Files）则跳过，落到下面的资源拷贝分支
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(6) {
            let cand = anc.join("knowledge");
            if looks_like_root(&cand) && probe_writable(&cand) {
                return info(cand, "ancestor");
            }
        }
    }

    // 6. cwd 邻近（同样要求可写）
    if let Ok(cwd) = std::env::current_dir() {
        for cand in [cwd.join("knowledge"), cwd.join("..").join("knowledge")] {
            if looks_like_root(&cand) && probe_writable(&cand) {
                return info(cand, "cwd");
            }
        }
    }

    // 7. 打包资源：拷贝到可写数据目录
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("knowledge");
        if looks_like_root(&bundled) {
            if let Some(data) = &data_dir {
                let target = data.join("knowledge");
                if !looks_like_root(&target) {
                    let _ = copy_dir_recursive(&bundled, &target);
                }
                if looks_like_root(&target) {
                    // 保留已有的 backups_dir 等配置，只补写 root
                    let mut cfg = read_config(app);
                    cfg.root = Some(target.to_string_lossy().to_string());
                    cfg.root_explicit = false;
                    let _ = write_config(app, &cfg);
                    return info(target, "resource-copy");
                }
            }
            // 数据目录不可写时只能用只读资源
            return info(bundled, "resource");
        }
    }

    // 8. 兜底（可能尚不存在，命令侧会报错）
    let fallback = std::env::current_dir()
        .unwrap_or_default()
        .join("knowledge");
    info(fallback, "fallback")
}

/// 至少包含一个子目录才认作知识库根，避免命中空目录。
fn looks_like_root(p: &Path) -> bool {
    p.is_dir()
        && fs::read_dir(p)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .any(|e| e.path().is_dir())
            })
            .unwrap_or(false)
}

fn info(p: PathBuf, source: &str) -> (PathBuf, RootInfo) {
    // 统一路径展示形式：去 verbatim 前缀、词法解析 ..、单一分隔符
    let cleaned = safe_path::clean(&p);
    let writable = probe_writable(&cleaned);
    (
        cleaned.clone(),
        RootInfo {
            path: cleaned.to_string_lossy().to_string(),
            source: source.to_string(),
            writable,
        },
    )
}

/// 尝试创建并删除探测文件，判断目录可写。
pub fn probe_writable(dir: &Path) -> bool {
    let probe = dir.join(".kv-write-test");
    match fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
