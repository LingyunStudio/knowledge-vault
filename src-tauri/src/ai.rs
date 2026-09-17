//! AI 对话：代理前端请求到 OpenAI 兼容 / OpenAI Responses / Anthropic 兼容 /
//! Gemini 原生四类接口，SSE 流式回传。Key 只经内存透传，不落盘、不打日志。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use crate::AppState;

#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    Delta { text: String },
    Error { message: String },
}

#[derive(Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

/// base URL → 完整端点。约定与各家 SDK 一致：
/// openai/responses：base 含 /v1 时只补动作路径；base 无路径时补 /v1/...；
/// anthropic：补 /v1/messages；gemini：补 /v1beta/models/{model}:streamGenerateContent。
fn endpoint(base_url: &str, format: &str, model: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let has_path = |u: &str| -> bool {
        u.split_once("://")
            .map(|(_, rest)| rest.contains('/'))
            .unwrap_or(false)
    };    match format {
        "anthropic" => {
            if base.ends_with("/messages") {
                base.to_string()
            } else {
                format!("{base}/v1/messages")
            }
        }
        "responses" => {
            if base.ends_with("/responses") {
                base.to_string()
            } else if has_path(base) {
                format!("{base}/responses")
            } else {
                format!("{base}/v1/responses")
            }
        }
        "gemini" => {
            if base.contains(":streamGenerateContent") || base.contains(":generateContent") {
                base.to_string()
            } else if has_path(base) {
                format!("{base}/models/{model}:streamGenerateContent?alt=sse")
            } else {
                format!("{base}/v1beta/models/{model}:streamGenerateContent?alt=sse")
            }
        }
        // openai
        _ => {
            if base.ends_with("/chat/completions") {
                base.to_string()
            } else if has_path(base) {
                format!("{base}/chat/completions")
            } else {
                format!("{base}/v1/chat/completions")
            }
        }
    }
}

fn auth_headers(req: reqwest::RequestBuilder, format: &str, api_key: &str) -> reqwest::RequestBuilder {
    match format {
        // Anthropic 系网关两种鉴权并存：官方用 x-api-key，多数中转用 Bearer Token；
        // 同时携带两个头以最大化兼容（与 cc-switch 的 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN 对应）
        "anthropic" => req
            .header("x-api-key", api_key)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("anthropic-version", "2023-06-01"),
        "gemini" => req.header("x-goog-api-key", api_key),
        _ => req.bearer_auth(api_key),
    }
}

/// 带重试的请求发送：响应到达前的传输抖动自动重试，且在「系统代理」与「直连」
/// 之间交替尝试（不少用户依赖代理访问官方端点，但代理又会卡住部分中转站）；
/// 流式响应开始后的中断不重试（避免内容重复）。
async fn send_with_retry(
    clients: [&reqwest::Client; 2],
    build: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    attempts: usize,
) -> Result<reqwest::Response, String> {
    let mut last_err = String::new();
    for attempt in 0..attempts {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
        match build(clients[attempt % 2]).send().await {
            Ok(resp) => return Ok(resp),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!("请求失败（已重试 {attempts} 次）：{last_err}"))
}

/// 构建一对 HTTP 客户端：(跟随系统代理, 强制直连)。
fn http_clients(timeout: Option<Duration>) -> (reqwest::Client, reqwest::Client) {
    let build = |no_proxy: bool| -> reqwest::Client {
        let b = reqwest::Client::builder().connect_timeout(Duration::from_secs(20));
        let b = match timeout {
            Some(t) => b.timeout(t),
            None => b,
        };
        let b = if no_proxy { b.no_proxy() } else { b };
        b.build().unwrap_or_else(|_| reqwest::Client::new())
    };
    (build(false), build(true))
}

fn request_body(format: &str, model: &str, messages: &[AiMessage]) -> Value {
    match format {
        "anthropic" => {
            let mut system = String::new();
            let mut rest = Vec::new();
            for m in messages {
                if m.role == "system" {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&m.content);
                } else {
                    rest.push(json!({"role": m.role, "content": m.content}));
                }
            }
            let mut body = json!({
                "model": model,
                "max_tokens": 8192,
                "messages": rest,
                "stream": true,
            });
            if !system.is_empty() {
                body["system"] = Value::String(system);
            }
            body
        }
        "responses" => {
            let mut instructions = String::new();
            let mut input = Vec::new();
            for m in messages {
                let content_type = if m.role == "assistant" {
                    "output_text"
                } else {
                    "input_text"
                };
                if m.role == "system" {
                    if !instructions.is_empty() {
                        instructions.push_str("\n\n");
                    }
                    instructions.push_str(&m.content);
                } else {
                    input.push(json!({
                        "role": m.role,
                        "content": [{"type": content_type, "text": m.content}],
                    }));
                }
            }
            let mut body = json!({ "model": model, "input": input, "stream": true });
            if !instructions.is_empty() {
                body["instructions"] = Value::String(instructions);
            }
            body
        }
        "gemini" => {
            let mut contents = Vec::new();
            let mut system = String::new();
            for m in messages {
                if m.role == "system" {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&m.content);
                } else {
                    let role = if m.role == "assistant" { "model" } else { "user" };
                    contents.push(json!({"role": role, "parts": [{"text": m.content}]}));
                }
            }
            let mut body = json!({ "contents": contents });
            if !system.is_empty() {
                body["systemInstruction"] = json!({"parts": [{"text": system}]});
            }
            body
        }
        _ => json!({
            "model": model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
        }),
    }
}

#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    request_id: String,
    base_url: String,
    api_key: String,
    format: String,
    model: String,
    messages: Vec<AiMessage>,
    on_event: Channel<AiEvent>,
) -> Result<(), String> {
    if base_url.trim().is_empty() || model.trim().is_empty() {
        return Err("模型配置不完整：请先在设置里填写 Base URL 和模型。".into());
    }
    let abort = Arc::new(AtomicBool::new(false));
    state
        .ai_aborts
        .lock()
        .unwrap()
        .insert(request_id.clone(), abort.clone());

    let result =
        stream_chat(&base_url, &api_key, &format, &model, &messages, &abort, &on_event).await;

    state.ai_aborts.lock().unwrap().remove(&request_id);
    match result {
        Ok(()) => Ok(()),
        Err(message) => {
            let _ = on_event.send(AiEvent::Error { message });
            Ok(())
        }
    }
}

#[tauri::command]
pub fn ai_abort(state: State<AppState>, request_id: String) {
    if let Some(flag) = state.ai_aborts.lock().unwrap().remove(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// 模型列表候选端点：优先命中与 base 最贴合的路径，失败则放宽
/// （去尾段、回退 origin 的 /v1[/v1beta]/models），兼容各家网关的路径习惯。
fn model_candidates(base_url: &str, format: &str) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/');
    let origin = match base.split_once("://") {
        Some((scheme, rest)) => format!("{scheme}://{}", rest.split('/').next().unwrap_or("")),
        None => base.to_string(),
    };
    let strip_last = |u: &str| -> Option<String> {
        let (scheme, rest) = u.split_once("://")?;
        let mut segs = rest.split('/').filter(|s| !s.is_empty());
        segs.next()?; // host
        let kept: Vec<&str> = segs.collect();
        if kept.len() < 2 {
            return None; // 只剩 host（或 host + 单段）不剥
        }
        Some(format!("{scheme}://{}/{}", rest.split('/').next()?, kept[..kept.len() - 1].join("/")))
    };

    let mut out: Vec<String> = Vec::new();
    let mut push = |u: String| {
        if !out.contains(&u) {
            out.push(u);
        }
    };

    match format {
        "anthropic" => {
            let root = base.strip_suffix("/v1/messages").unwrap_or(base);
            push(format!("{root}/v1/models"));
            if let Some(s) = strip_last(root) {
                push(format!("{s}/v1/models"));
            }
            push(format!("{origin}/v1/models"));
        }
        "gemini" => {
            let root = base
                .split(":streamGenerateContent")
                .next()
                .unwrap_or(base)
                .trim_end_matches('/')
                .to_string();
            let root = match root.rfind("/models/") {
                Some(i) => root[..i].to_string(),
                None => root,
            };
            if root != origin {
                push(format!("{root}/models"));
            } else {
                push(format!("{origin}/v1beta/models"));
            }
            if let Some(s) = strip_last(&root) {
                push(format!("{s}/v1beta/models"));
            }
            push(format!("{origin}/v1beta/models"));
        }
        _ => {
            let root = base
                .trim_end_matches("/chat/completions")
                .trim_end_matches("/responses")
                .trim_end_matches("/models")
                .to_string();
            if root != origin {
                push(format!("{root}/models"));
            }
            if let Some(s) = strip_last(&root) {
                push(format!("{s}/v1/models"));
            }
            push(format!("{origin}/v1/models"));
        }
    }
    out
}

/// 解析三种模型列表响应；结构对不上时返回 None 以便尝试下一个候选端点。
fn parse_models(text: &str, format: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(text).ok()?;
    let mut out: Vec<String> = Vec::new();
    match format {
        "gemini" => {
            for m in v.get("models")?.as_array()? {
                let name = m.get("name")?.as_str()?;
                let id = name.strip_prefix("models/").unwrap_or(name);
                if let Some(methods) = m.get("supportedGenerationMethods").and_then(|x| x.as_array())
                {
                    if !methods.iter().any(|x| x.as_str() == Some("generateContent")) {
                        continue;
                    }
                }
                out.push(id.to_string());
            }
        }
        // OpenAI 兼容与 Anthropic 的 /models 都是 {"data":[{"id":...}]}
        _ => {
            for m in v.get("data")?.as_array()? {
                if let Some(id) = m.get("id").and_then(|x| x.as_str()) {
                    out.push(id.to_string());
                }
            }
        }
    }
    let mut uniq: Vec<String> = Vec::new();
    for id in out {
        if !uniq.contains(&id) {
            uniq.push(id);
        }
    }
    Some(uniq)
}

#[tauri::command]
pub async fn ai_list_models(
    base_url: String,
    api_key: String,
    format: String,
) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("请先填写 Base URL。".into());
    }
    let (proxied, direct) = http_clients(Some(Duration::from_secs(25)));
    let mut last_err = "所有候选端点均失败".to_string();
    for url in model_candidates(&base_url, &format) {
        let resp = send_with_retry(
            [&proxied, &direct],
            |client| auth_headers(client.get(&url), &format, api_key.trim()),
            3,
        )
        .await;
        match resp {
            Ok(r) => match r.text().await {
                Ok(text) => {
                    if let Some(models) = parse_models(&text, &format) {
                        if !models.is_empty() {
                            return Ok(models);
                        }
                    }
                    last_err = format!("端点返回了无法识别的内容：{url}");
                }
                Err(e) => last_err = format!("{e}（{url}）"),
            },
            Err(e) => last_err = format!("{e}（{url}）"),
        }
    }
    Err(format!("获取模型列表失败：{last_err}"))
}

/// 画图端点：OpenAI Images API（/v1/images/generations），兼容无路径 base。
fn images_endpoint(base_url: &str) -> String {
    let root = base_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/images/generations")
        .trim_end_matches("/chat/completions")
        .trim_end_matches("/responses");
    let has_path = root.split_once("://").map(|(_, rest)| rest.contains('/')).unwrap_or(false);
    if has_path {
        format!("{root}/images/generations")
    } else {
        format!("{root}/v1/images/generations")
    }
}

/// 画图（OpenAI Images API，非流式；出图后以 Markdown 图片增量回传）。
#[tauri::command]
pub async fn ai_image(
    state: State<'_, AppState>,
    request_id: String,
    base_url: String,
    api_key: String,
    model: String,
    prompt: String,
    on_event: Channel<AiEvent>,
) -> Result<(), String> {
    if base_url.trim().is_empty() || model.trim().is_empty() || prompt.trim().is_empty() {
        return Err("画图请求不完整：需要 Base URL、模型和画面描述。".into());
    }
    let abort = Arc::new(AtomicBool::new(false));
    state
        .ai_aborts
        .lock()
        .unwrap()
        .insert(request_id.clone(), abort.clone());

    let result = generate_image(&base_url, &api_key, &model, &prompt, &abort, &on_event).await;
    state.ai_aborts.lock().unwrap().remove(&request_id);
    match result {
        Ok(()) => Ok(()),
        Err(message) => {
            let _ = on_event.send(AiEvent::Error { message });
            Ok(())
        }
    }
}

async fn generate_image(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    abort: &AtomicBool,
    on_event: &Channel<AiEvent>,
) -> Result<(), String> {
    // 出图普遍要几十秒，放宽整体超时；传输抖动自动重试并在代理/直连间回退
    let (proxied, direct) = http_clients(Some(Duration::from_secs(300)));
    let url = images_endpoint(base_url);
    let body = json!({ "model": model, "prompt": prompt, "n": 1 });

    let resp = send_with_retry(
        [&proxied, &direct],
        |client| client.post(&url).bearer_auth(api_key).json(&body),
        3,
    )
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(600).collect();
        return Err(format!("HTTP {status}：{short}"));
    }
    if abort.load(Ordering::Relaxed) {
        return Ok(());
    }

    let v: Value = resp.json().await.map_err(|e| format!("响应解析失败：{e}"))?;
    let first = v
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| {
            v.pointer("/error/message")
                .and_then(|m| m.as_str())
                .map(|m| m.to_string())
                .unwrap_or_else(|| "响应中没有图片数据".to_string())
        })?;
    let url = first.get("url").and_then(|u| u.as_str()).unwrap_or("");
    let b64 = first.get("b64_json").and_then(|b| b.as_str()).unwrap_or("");
    let data_url = if !url.is_empty() {
        url.to_string()
    } else if !b64.is_empty() {
        format!("data:image/png;base64,{b64}")
    } else {
        return Err("响应中没有图片数据".into());
    };
    if abort.load(Ordering::Relaxed) {
        return Ok(());
    }
    let _ = on_event.send(AiEvent::Delta {
        text: format!("\n\n![生成的图片]({data_url})\n"),
    });
    Ok(())
}

async fn stream_chat(
    base_url: &str,
    api_key: &str,
    format: &str,
    model: &str,
    messages: &[AiMessage],
    abort: &AtomicBool,
    on_event: &Channel<AiEvent>,
) -> Result<(), String> {
    let url = endpoint(base_url, format, model);
    let (proxied, direct) = http_clients(None);
    let body = request_body(format, model, messages);

    let resp = send_with_retry(
        [&proxied, &direct],
        |client| auth_headers(client.post(&url), format, api_key).json(&body),
        3,
    )
    .await
    .map_err(|e| format!("请求失败：{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(600).collect();
        return Err(format!("HTTP {status}：{short}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    loop {
        if abort.load(Ordering::Relaxed) {
            return Ok(());
        }
        let has_more = match stream.next().await {
            Some(Ok(chunk)) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                true
            }
            Some(Err(e)) => return Err(format!("连接中断：{e}")),
            None => false,
        };
        // SSE 逐行分发；流结束后把无换行的尾巴也当作一行处理
        while buf.contains('\n') || (!has_more && !buf.is_empty()) {
            let idx = match buf.find('\n') {
                Some(i) => i,
                None => buf.len(),
            };
            let mut line = buf.drain(..idx).collect::<String>();
            if buf.starts_with('\n') {
                buf.remove(0);
            }
            if let Some(text) = sse_line(&mut line, format)? {
                if !text.is_empty() {
                    on_event
                        .send(AiEvent::Delta { text })
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        if !has_more {
            break;
        }
    }
    Ok(())
}

/// 处理一行 SSE data；返回 Some(text) 表示增量文本，None 表示其他事件。
fn sse_line(line: &mut String, format: &str) -> Result<Option<String>, String> {
    let line = line.trim_end_matches(['\n', '\r']);
    let Some(data) = line.strip_prefix("data:") else {
        return Ok(None);
    };
    let data = data.trim_start();
    if data.is_empty() || data == "[DONE]" {
        return Ok(None);
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return Ok(None); // 心跳、注释等非 JSON 行
    };
    match format {
        "anthropic" => match v.get("type").and_then(|t| t.as_str()) {
            Some("content_block_delta") => Ok(Some(
                v.pointer("/delta/text")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string(),
            )),
            Some("error") => Err(
                v.pointer("/error/message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("流式响应错误")
                    .to_string(),
            ),
            _ => Ok(None),
        },
        // OpenAI Responses API：response.output_text.delta 携带增量
        "responses" => match v.get("type").and_then(|t| t.as_str()) {
            Some("response.output_text.delta") => Ok(Some(
                v.get("delta").and_then(|t| t.as_str()).unwrap_or("").to_string(),
            )),
            Some("response.failed") => Err(v
                .pointer("/response/error/message")
                .and_then(|m| m.as_str())
                .unwrap_or("生成失败")
                .to_string()),
            Some("error") => {
                let msg = v
                    .pointer("/error/message")
                    .or_else(|| v.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("流式响应错误");
                Err(msg.to_string())
            }
            _ => Ok(None),
        },
        // Gemini 原生 streamGenerateContent：candidates[0].content.parts[].text
        "gemini" => {
            if let Some(msg) = v.pointer("/error/message").and_then(|m| m.as_str()) {
                return Err(msg.to_string());
            }
            let text = v
                .pointer("/candidates/0/content/parts")
                .and_then(|p| p.as_array())
                .map(|parts| {
                    parts
                        .iter()
                        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                        .collect::<String>()
                })
                .unwrap_or_default();
            Ok(Some(text))
        }
        // OpenAI Chat Completions
        _ => Ok(Some(
            v.pointer("/choices/0/delta/content")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
        )),
    }
}
