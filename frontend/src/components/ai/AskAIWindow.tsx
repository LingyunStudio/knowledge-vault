import { useEffect, useMemo, useRef, useState } from "react";
import { LogicalPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { currentMonitor } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import {
  generateImage,
  streamChat,
  type ChatMsg,
  type StreamHandle,
} from "../../lib/ai-client";
import { renderMarkdownLite } from "../../lib/md-lite";
import { BUILTIN_PROVIDER, isImageModel } from "../../lib/ai-presets";
import type { AiArticleContext } from "../../lib/ai-window";
import {
  loadAlwaysOnTop,
  saveAlwaysOnTop,
  saveWindowRect,
} from "../../lib/ai-window";
import { activeProvider, useAi } from "../../store/ai";
import { AiSettings } from "./AiSettings";

const BODY_LIMIT = 16000;
const HISTORY_LIMIT = 24;
const IMAGE_PROMPT_EXCERPT = 1200;

const QUICK_ASKS = ["总结全文", "讲解难点", "出 5 道练习题", "常见易错点"];

const QUICK_PROMPTS: Record<string, string> = {
  总结全文: "请用 200 字左右总结这篇文章的核心内容，再给出 3-5 条要点。",
  讲解难点: "请挑出这篇文章中最难的 3 个概念，逐一用通俗的语言和例子讲解。",
  "出 5 道练习题":
    "请针对这篇文章出 5 道由浅入深的练习题，附答案与解析。",
  常见易错点:
    "这篇文章的知识点，实际使用中最常见的错误和易混淆点有哪些？怎么避免？",
};

function buildSystemPrompt(ctx: AiArticleContext | null): string {
  if (!ctx || (!ctx.title && !ctx.body)) {
    return "你是「知识库」应用的学习助教。当前没有打开文章，请就用户的问题直接作答：使用简体中文，Markdown 排版，代码用代码块。";
  }
  let body = ctx.body;
  if (body.length > BODY_LIMIT) {
    body = `${body.slice(0, BODY_LIMIT)}\n\n（正文过长，已截断）`;
  }
  return [
    `你是「知识库」应用的学习助教。用户正在阅读文章《${ctx.title || "无标题"}》，请回答与该文章相关的问题。`,
    "要求：",
    "- 使用简体中文，Markdown 排版；代码用代码块。",
    "- 优先基于文章内容回答；文章未涉及的内容可以补充，但请注明「文章未提及」。",
    "- 回答直接切题，不要空话。",
    "",
    "以下是文章的 Markdown 正文：",
    "---",
    body,
    "---",
  ].join("\n");
}

/** 画图 prompt 融入文章主题，让配图贴合内容 */
function buildImagePrompt(desc: string, ctx: AiArticleContext | null): string {
  if (!ctx || !ctx.title) return desc;
  const excerpt = ctx.body.slice(0, IMAGE_PROMPT_EXCERPT);
  return [
    `为文章《${ctx.title}》生成一张配图。画面要求：${desc}`,
    excerpt ? `\n（文章开头内容，供把握主题：\n${excerpt}\n）` : "",
  ]
    .join("")
    .trim();
}

function useAiContext() {
  const [ctx, setCtx] = useState<AiArticleContext | null>(null);

  useEffect(() => {
    const un = listen<AiArticleContext>("kv:ai-ctx", (e) => setCtx(e.payload));
    // 打开 / 获得焦点时主动向主窗口要一次上下文
    void emit("kv:ai-ctx-req", {}).catch(() => {});
    const win = getCurrentWindow();
    const pFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) void emit("kv:ai-ctx-req", {}).catch(() => {});
    });
    return () => {
      void un.then((f) => f());
      void pFocus.then((f) => f());
    };
  }, []);

  return ctx;
}

/** 记住窗口位置与尺寸（逻辑像素），下次打开还原；拖到屏幕边缘自动吸附 */
function useWindowGeometry() {
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: number | undefined;
    const work = async () => {
      try {
        const [pos, size, factor] = await Promise.all([
          win.outerPosition(),
          win.innerSize(),
          win.scaleFactor(),
        ]);
        let rect = {
          x: Math.round(pos.x / factor),
          y: Math.round(pos.y / factor),
          w: Math.round(size.width / factor),
          h: Math.round(size.height / factor),
        };
        // 边缘吸附：距离屏幕边缘 24 逻辑像素内时贴齐
        const mon = await currentMonitor().catch(() => null);
        if (mon) {
          const mLeft = mon.position.x / factor;
          const mTop = mon.position.y / factor;
          const mRight = mLeft + mon.size.width / factor;
          const mBottom = mTop + mon.size.height / factor;
          const TH = 24;
          let { x, y } = rect;
          if (Math.abs(x - mLeft) < TH) x = mLeft;
          else if (Math.abs(x + rect.w - mRight) < TH) x = mRight - rect.w;
          if (Math.abs(y - mTop) < TH) y = mTop;
          else if (Math.abs(y + rect.h - mBottom) < TH) y = mBottom - rect.h;
          if (Math.abs(x - rect.x) > 0.5 || Math.abs(y - rect.y) > 0.5) {
            await win.setPosition(new LogicalPosition(x, y)).catch(() => {});
            rect = { ...rect, x, y };
          }
        }
        saveWindowRect(rect);
      } catch {
        // 窗口关闭瞬间读取失败可忽略
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(work, 350);
    };
    const p1 = win.onMoved(schedule);
    const p2 = win.onResized(schedule);
    return () => {
      window.clearTimeout(timer);
      void Promise.all([p1, p2]).then((fs) => fs.forEach((f) => f()));
    };
  }, []);
}

/** 窗口置顶开关（默认开启，状态持久化） */
function useAlwaysOnTop() {
  const [ontop, setOntop] = useState(() => loadAlwaysOnTop());

  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(ontop).catch(() => {});
  }, [ontop]);

  const toggle = () => {
    saveAlwaysOnTop(!ontop);
    setOntop((v) => !v);
  };

  return { ontop, toggle };
}

/** 其他窗口修改模型设置时，通过 storage 事件同步本窗口的 store */
function useCrossWindowStoreSync() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "knowledge-vault-ai") void useAi.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}

export function AskAIWindow() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const provider = useAi(activeProvider);
  const customProviders = useAi((s) => s.providers);
  const providers = useMemo(
    () => [BUILTIN_PROVIDER, ...customProviders],
    [customProviders],
  );
  const setSettingsOpen = useAi((s) => s.setSettingsOpen);

  const ctx = useAiContext();
  useWindowGeometry();
  const { ontop, toggle: toggleOntop } = useAlwaysOnTop();
  useCrossWindowStoreSync();

  useEffect(() => {
    document.title = "问 AI";
  }, []);

  const imageMode = isImageModel(provider.model);

  // —— 灯箱：滚轮缩放 + 拖拽平移 ——
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const lbBodyRef = useRef<HTMLDivElement>(null);

  const openLightbox = (src: string) => {
    setLightbox(src);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const closeLightbox = () => {
    setLightbox(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const panMoved = useRef(false);

  useEffect(() => {
    if (!lightbox) return;
    const el = lbBodyRef.current;
    if (!el) return;
    // React 的 wheel 监听是 passive 的，滚轮缩放需要非 passive 才能阻止页面滚动
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((z) => Math.min(10, Math.max(0.2, z * f)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [lightbox]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, error, streaming]);

  const dropEmptyTail = () =>
    setMsgs((prev) => {
      const last = prev[prev.length - 1];
      return last?.role === "assistant" && !last.content
        ? prev.slice(0, -1)
        : prev;
    });

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || streaming) return;
    const history = [...msgs, { role: "user" as const, content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);

    const patchLast = (fn: (content: string) => string) =>
      setMsgs((prev) => {
        if (prev.length === 0) return prev;
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last.role !== "assistant") return prev;
        copy[copy.length - 1] = { ...last, content: fn(last.content) };
        return copy;
      });

    const onError = (message: string) => {
      setError(message);
      setStreaming(false);
      dropEmptyTail();
    };
    const onDone = () => setStreaming(false);

    const handle = imageMode
      ? generateImage({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          prompt: buildImagePrompt(text, ctx),
          onDelta: (t) => patchLast((c) => c + t),
          onError,
          onDone,
        })
      : streamChat({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          format: provider.format,
          model: provider.model,
          messages: [
            { role: "system", content: buildSystemPrompt(ctx) },
            ...history.slice(-HISTORY_LIMIT),
          ],
          onDelta: (t) => patchLast((c) => c + t),
          onError,
          onDone,
        });
    streamRef.current = handle;
  };

  const abort = () => {
    streamRef.current?.abort();
    streamRef.current = null;
    setStreaming(false);
    dropEmptyTail();
  };

  const newChat = () => {
    if (streaming) abort();
    streamRef.current = null;
    setMsgs([]);
    setError(null);
    setInput("");
    inputRef.current?.focus();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  // 点击 AI 回复里的图片 → 灯箱放大
  const onMsgsClick = (e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest?.(".ai-md img");
    if (img instanceof HTMLImageElement && img.src) openLightbox(img.src);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="ai-window">
      <header className="ai-window-head">
        <span className="ai-window-title">问 AI</span>
        <select
          className="ai-model-select"
          title="切换模型"
          value={provider.id}
          onChange={(e) => useAi.getState().setActive(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button
          className={`ai-icon-btn${ontop ? " pin-on" : ""}`}
          title={ontop ? "取消窗口置顶" : "窗口置顶"}
          onClick={toggleOntop}
        >
          📌
        </button>
        <button className="ai-icon-btn" title="新建会话" onClick={newChat}>
          ＋
        </button>
        <button
          className="ai-icon-btn"
          title="AI 模型设置"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </header>

      <div className="ai-window-ctx" title={ctx ? `rel: ${ctx.rel}` : ""}>
        {ctx?.title
          ? `正在阅读：《${ctx.title}》`
          : "主窗口未打开文章，直接提问即可"}
      </div>

      <div className="ai-msgs scroll-thin" ref={listRef} onClick={onMsgsClick}>
        {msgs.length === 0 && !error && (
          <div className="ai-empty">
            <p>
              {imageMode
                ? "当前模型是画图模型：输入画面描述并发送，会结合正在阅读的文章主题生成配图。"
                : "回答会自动结合主窗口正在阅读的文章。也可以在下方点击快捷提问。"}
            </p>
          </div>
        )}

        {msgs.map((m, i) => {
          if (m.role === "user") {
            return (
              <div className="ai-msg user" key={i}>
                {m.content}
              </div>
            );
          }
          const isLast = i === msgs.length - 1;
          return (
            <div className="ai-msg ai" key={i}>
              {m.content ? (
                <div
                  className="ai-md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownLite(m.content) }}
                />
              ) : null}
              {isLast && streaming && (
                <span className="ai-cursor" aria-hidden>
                  ▍
                </span>
              )}
            </div>
          );
        })}

        {error && (
          <div className="ai-error">
            <div className="ai-error-msg">{error}</div>
            <button onClick={() => setSettingsOpen(true)}>打开 AI 设置</button>
          </div>
        )}
      </div>

      {!streaming && !imageMode && (
        <div className="ai-quickbar scroll-thin">
          {QUICK_ASKS.map((q) => (
            <button key={q} onClick={() => send(QUICK_PROMPTS[q])}>
              {q}
            </button>
          ))}
        </div>
      )}

      <footer className="ai-input">
        <textarea
          ref={inputRef}
          value={input}
          rows={2}
          placeholder={
            streaming
              ? "生成中…"
              : imageMode
                ? "描述想生成的画面…（Enter 发送）"
                : "针对本文提问…（Enter 发送，Shift+Enter 换行）"
          }
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKey}
        />
        {streaming ? (
          <button className="ai-send stop" title="停止生成" onClick={abort}>
            ■
          </button>
        ) : (
          <button
            className="ai-send"
            title="发送"
            disabled={!input.trim()}
            onClick={() => send(input)}
          >
            ↑
          </button>
        )}
      </footer>

      {lightbox && (
        <div
          className="ai-lightbox"
          onClick={() => {
            if (panMoved.current) {
              panMoved.current = false; // 拖拽平移结束的误触不关闭
              return;
            }
            closeLightbox();
          }}
          onDoubleClick={() => setZoom((z) => (z > 1.01 ? 1 : 2.5))}
        >
          <div
            className="ai-lightbox-body"
            ref={lbBodyRef}
            onPointerDown={(e) => {
              panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
              panMoved.current = false;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = panRef.current;
              if (d) {
                const dx = e.clientX - d.sx;
                const dy = e.clientY - d.sy;
                if (Math.abs(dx) + Math.abs(dy) > 3) panMoved.current = true;
                setPan({ x: d.px + dx, y: d.py + dy });
              }
            }}
            onPointerUp={() => (panRef.current = null)}
            onPointerCancel={() => (panRef.current = null)}
          >
            <img
              src={lightbox}
              alt="预览"
              draggable={false}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                cursor: panRef.current ? "grabbing" : "grab",
              }}
            />
          </div>
          <div className="ai-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}>−</button>
            <span className="ai-lightbox-zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(10, z * 1.25))}>＋</button>
            <button
              title="适应窗口"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              ⟲
            </button>
            <button onClick={() => closeLightbox()}>✕</button>
          </div>
        </div>
      )}

      <AiSettings />
    </div>
  );
}
