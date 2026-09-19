//! 系统凭据库：自定义供应商的 API Key 存取。
//!
//! Key 存入操作系统凭据管理器（Windows 凭据管理器，keyring `windows-native`），
//! 不再写入 WebView 的 localStorage。凭据条目为通用凭据
//! `com.local.knowledge-vault/<供应商 id>`，随用户账户加密，其他账户不可读。
//! 空字符串写入的语义是删除该凭据。

use keyring::Entry;

/// 凭据服务名（与 Tauri 应用标识一致，便于在凭据管理器中辨认来源）
const SERVICE: &str = "com.local.knowledge-vault";

/// Windows 凭据 blob 上限 2560 字节（UTF-16 编码约 1280 字符），留出余量
const MAX_KEY_LEN: usize = 1024;

/// 供应商 id 校验：id 由前端生成（`ai-<时间戳>-<随机串>`），只允许安全字符，
/// 避免把任意字符串写进系统凭据库。
fn validate_id(id: &str) -> Result<(), String> {
    let invalid = || "供应商 id 非法".to_string();
    if id.is_empty() || id.len() > 128 {
        return Err(invalid());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(invalid());
    }
    Ok(())
}

fn entry(id: &str) -> Result<Entry, String> {
    validate_id(id)?;
    Entry::new(SERVICE, id).map_err(|e| format!("系统凭据库不可用：{e}"))
}

/// 保存 Key；传空串表示清除。
#[tauri::command]
pub async fn credential_set(id: String, api_key: String) -> Result<(), String> {
    if api_key.len() > MAX_KEY_LEN {
        return Err(format!("API Key 过长（上限 {MAX_KEY_LEN} 字符）"));
    }
    let entry = entry(&id)?;
    tokio::task::spawn_blocking(move || {
        if api_key.is_empty() {
            delete_entry(&entry)
        } else {
            entry
                .set_password(&api_key)
                .map_err(|e| format!("保存凭据失败：{e}"))
        }
    })
    .await
    .map_err(|e| format!("凭据任务失败：{e}"))?
}

/// 读取 Key；无条目返回 None。
#[tauri::command]
pub async fn credential_get(id: String) -> Result<Option<String>, String> {
    let entry = entry(&id)?;
    tokio::task::spawn_blocking(move || match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("读取凭据失败：{e}")),
    })
    .await
    .map_err(|e| format!("凭据任务失败：{e}"))?
}

/// 删除 Key；条目本就不存在视为成功。
#[tauri::command]
pub async fn credential_delete(id: String) -> Result<(), String> {
    let entry = entry(&id)?;
    tokio::task::spawn_blocking(move || delete_entry(&entry))
        .await
        .map_err(|e| format!("凭据任务失败：{e}"))?
}

fn delete_entry(entry: &Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除凭据失败：{e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_validation_accepts_frontend_generated_ids() {
        assert!(validate_id("ai-lx2k3-abc123").is_ok());
        assert!(validate_id("custom-model-1").is_ok());
        assert!(validate_id("A._-9").is_ok());
    }

    #[test]
    fn id_validation_rejects_path_like_or_empty_or_oversize() {
        assert!(validate_id("").is_err());
        assert!(validate_id("../evil").is_err());
        assert!(validate_id("a/b").is_err());
        assert!(validate_id("a\\b").is_err());
        assert!(validate_id("带中文").is_err());
        assert!(validate_id(&"x".repeat(129)).is_err());
    }

    /// 触碰真实系统凭据库的冒烟测试：写入→读回→删除，不留残留。
    /// 默认忽略，需要时显式运行：cargo test --lib credentials -- --ignored
    #[test]
    #[ignore = "读写真实系统凭据库，用 --ignored 显式运行"]
    fn keyring_roundtrip_against_real_credential_store() {
        let entry = entry("ai-smoke-test").expect("entry");
        entry.set_password("sk-smoke").expect("set");
        assert_eq!(entry.get_password().expect("get"), "sk-smoke");
        entry.delete_credential().expect("delete");
        assert!(matches!(
            entry.get_password(),
            Err(keyring::Error::NoEntry)
        ));
    }
}
