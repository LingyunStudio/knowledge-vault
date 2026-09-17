/** 问 AI 独立窗口：创建 / 聚焦 / 位置尺寸记忆 / 文章上下文事件。 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";

const LABEL = "ask-ai";

export interface AiArticleContext {
  /** Active library identity; include even when no article is open. */
  rootPath?: string;
  /** Destination section for explicitly saved AI notes. */
  secId?: string;
  rel: string;
  title: string;
  body: string;
}

const RECT_KEY = "knowledge-vault-ai-winrect";
const ONTOP_KEY = "knowledge-vault-ai-ontop";

export function loadAlwaysOnTop(): boolean {
  return localStorage.getItem(ONTOP_KEY) !== "0"; // 默认置顶
}

export function saveAlwaysOnTop(on: boolean) {
  localStorage.setItem(ONTOP_KEY, on ? "1" : "0");
}

export function saveWindowRect(rect: { x: number; y: number; w: number; h: number }) {
  localStorage.setItem(RECT_KEY, JSON.stringify(rect));
}

export function loadWindowRect(): { x: number; y: number; w: number; h: number } | null {
  try {
    const r = JSON.parse(localStorage.getItem(RECT_KEY) || "null");
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 200 && r.h > 300) return r;
  } catch {
    // 忽略损坏数据
  }
  return null;
}

let cached: WebviewWindow | null = null;

/** 打开（或聚焦已存在的）问 AI 窗口。 */
export async function openAskAIWindow(): Promise<void> {
  if (cached) {
    const alive = await cached.isVisible().then(() => true).catch(() => false);
    if (alive) {
      await cached.setFocus().catch(() => {});
      return;
    }
    cached = null;
  }

  const rect = loadWindowRect();
  const win = new WebviewWindow(LABEL, {
    url: "index.html?window=ask-ai",
    title: "问 AI",
    alwaysOnTop: loadAlwaysOnTop(), // 默认置顶，窗口内 📌 可切换
    ...(rect
      ? { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
      : { center: true, width: 480, height: 720 }),
    minWidth: 340,
    minHeight: 420,
  });
  cached = win;
  // 标签冲突（窗口已存在但本页失去句柄，常见于主窗口热更新后）：让旧窗口自己聚焦
  win.once("tauri://error", () => {
    cached = null;
    void emit("kv:ai-focus-req", {}).catch(() => {});
  });
  void win.once("tauri://created", () => {
    void win.setFocus().catch(() => {});
  });
}

/** 主窗口向 ask-ai 广播当前文章上下文。 */
export function emitAiContext(ctx: AiArticleContext): void {
  void emit("kv:ai-ctx", ctx).catch(() => {});
}
