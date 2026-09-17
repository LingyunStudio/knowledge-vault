/** AI 对话客户端：经 Rust 端 ai_chat 代理流式请求（绕开 CSP 与浏览器限制）。 */

import { Channel, invoke } from "@tauri-apps/api/core";

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

export type AiEvent =
  | { type: "delta"; text: string }
  | { type: "error"; message: string };

export interface StreamOptions {
  baseUrl: string;
  apiKey: string;
  format: string;
  model: string;
  messages: ChatMsg[];
  onDelta: (text: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export interface StreamHandle {
  abort: () => void;
}

/** 拉取供应商的模型列表（Rust 端自动尝试多个候选端点）。 */
export async function listModels(
  baseUrl: string,
  apiKey: string,
  format: string,
): Promise<string[]> {
  return invoke<string[]>("ai_list_models", { baseUrl, apiKey, format });
}

/** 画图：走 OpenAI Images API（/v1/images/generations），非流式。 */
export function generateImage(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  onDelta: (text: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}): StreamHandle {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  const channel = new Channel<AiEvent>();
  channel.onmessage = (ev) => {
    if (ev.type === "delta") opts.onDelta(ev.text);
    else opts.onError(ev.message);
  };
  invoke("ai_image", {
    requestId,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    model: opts.model,
    prompt: opts.prompt,
    onEvent: channel,
  })
    .then(() => window.setTimeout(opts.onDone, 60))
    .catch((e) => opts.onError(String(e)));
  return {
    abort: () => {
      void invoke("ai_abort", { requestId }).catch(() => {});
    },
  };
}

export function streamChat(opts: StreamOptions): StreamHandle {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  const channel = new Channel<AiEvent>();
  channel.onmessage = (ev) => {
    if (ev.type === "delta") opts.onDelta(ev.text);
    else opts.onError(ev.message);
  };
  // 命令返回 = 流结束（错误已通过事件上报）；稍作延迟让尾部增量先落地
  invoke("ai_chat", {
    requestId,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    format: opts.format,
    model: opts.model,
    messages: opts.messages,
    onEvent: channel,
  })
    .then(() => window.setTimeout(opts.onDone, 60))
    .catch((e) => opts.onError(String(e)));
  return {
    abort: () => {
      void invoke("ai_abort", { requestId }).catch(() => {});
    },
  };
}
