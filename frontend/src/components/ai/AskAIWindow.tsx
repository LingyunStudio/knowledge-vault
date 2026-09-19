import { useEffect, useRef, useState } from "react";
import { LogicalPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { currentMonitor } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import {
  generateImage,
  streamChat,
  type StreamHandle,
} from "../../lib/ai-client";
import { renderMarkdownLite } from "../../lib/md-lite";
import { isImageModel } from "../../lib/ai-presets";
import type { AiArticleContext } from "../../lib/ai-window";
import {
  loadAlwaysOnTop,
  saveAlwaysOnTop,
  saveWindowRect,
  useAiStoreStorageSync,
} from "../../lib/ai-window";
import { activeProvider, useAi } from "../../store/ai";
import { AiSettings } from "./AiSettings";

import { ipc } from "../../lib/ipc";
import {
  articleSources, learningPrompt, retrieveSources, requestHistory,
  loadSessions, persistSessions, sessionMatches, sameRoot,
  saveAnswerNote, sourceRel, textOnly, MAX_MESSAGES,
  type AiSession, type AiSource, type ContextScope, type LearningMessage,
} from "../../lib/ai-learning";
import type { AiProvider } from "../../lib/ai-presets";
import "../../styles/ai-learning.css";

interface PreparedRequest {
  text: string;
  scope: ContextScope;
  sources: AiSource[];
  provider: AiProvider;
  history: ReturnType<typeof requestHistory>;
  imagePrompt?: string;
}

const QUICK_ASKS = ["总结全文", "讲解难点", "出 5 道练习题", "常见易错点"];

const QUICK_PROMPTS: Record<string, string> = {
  总结全文: "请用 200 字左右总结这篇文章的核心内容，再给出 3-5 条要点。",
  讲解难点: "请挑出这篇文章中最难的 3 个概念，逐一用通俗的语言和例子讲解。",
  "出 5 道练习题":
    "请针对这篇文章出 5 道由浅入深的练习题，附答案与解析。",
  常见易错点:
    "这篇文章的知识点，实际使用中最常见的错误和易混淆点有哪些？怎么避免？",
};

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

export function AskAIWindow() {
  const [loaded] = useState(() => {
    try { return loadSessions(localStorage); }
    catch { return { sessions: [] as AiSession[], error: "本地会话存储不可用。" }; }
  });
  const [sessions, setSessions] = useState(loaded.sessions);
  const sessionsRef = useRef(sessions);
  const [storageError, setStorageError] = useState<string | null>(loaded.error);
  const storageBlocked = useRef(!!loaded.error);
  const [activeId, setActiveId] = useState("");
  const active = sessions.find((s) => s.id === activeId);
  const msgs = active?.messages ?? [];
  const [scope, setScope] = useState<ContextScope>("article");
  const [rootPath, setRootPath] = useState("");
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const saveBusy = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const provider = useAi(activeProvider);
  const providers = useAi((s) => s.providers);
  const setSettingsOpen = useAi((s) => s.setSettingsOpen);

  const ctx = useAiContext();
  useWindowGeometry();
  const { ontop, toggle: toggleOntop } = useAlwaysOnTop();
  useAiStoreStorageSync();

  useEffect(() => {
    document.title = "问 AI";
  }, []);

  const imageMode = !!provider && isImageModel(provider.model);
  const articleRel = ctx?.rel ?? "";
  const scopedSessions = sessions.filter((s) => sessionMatches(s, rootPath, articleRel));
  const ready = !!rootPath && !!active && sessionMatches(active, rootPath, articleRel);
  const currentIdentity = `${rootPath}\n${articleRel}`;
  const identityRef = useRef(currentIdentity);
  identityRef.current = currentIdentity;

  const updateSessions = (fn: (prev: AiSession[]) => AiSession[]) => {
    const next = fn(sessionsRef.current);
    sessionsRef.current = next;
    setSessions(next);
    if (!storageBlocked.current) {
      try { setStorageError(persistSessions(localStorage, next)); }
      catch { setStorageError("AI 会话存储不可用，关闭窗口可能丢失内容。"); }
    }
  };
  const updateMessages = (id: string, fn: (prev: LearningMessage[]) => LearningMessage[]) =>
    updateSessions((prev) => prev.map((s) => s.id === id ? { ...s, updatedAt: Date.now(), messages: fn(s.messages) } : s));

  useEffect(() => {
    let alive = true;
    setRootPath("");
    void ipc.libraryRoot().then((root) => {
      if (!alive) return;
      if (ctx?.rootPath && !sameRoot(ctx.rootPath, root.path)) {
        setError("主窗口上下文与当前资料库不一致，请重新打开文章。");
        return;
      }
      setRootPath(root.path);
    }).catch((e) => alive && setError(`无法确认资料库：${String(e)}`));
    return () => { alive = false; };
  }, [ctx?.rootPath]);

  useEffect(() => {
    generation.current++;
    streamRef.current?.abort();
    streamRef.current = null;
    busy.current = false;
    setStreaming(false);
    setPreparing(false);
    setPrepared(null);
    setInput("");
    setSavedNote(null);
    if (!rootPath) { setActiveId(""); return; }
    const existing = sessionsRef.current.find((s) => sessionMatches(s, rootPath, articleRel));
    if (existing) setActiveId(existing.id);
    else {
      const session: AiSession = { id: crypto.randomUUID(), rootPath, articleRel,
        title: ctx?.title || "自由会话", updatedAt: Date.now(), messages: [] };
      updateSessions((prev) => [session, ...prev].slice(0, 24));
      setActiveId(session.id);
    }
  }, [rootPath, articleRel]);

  useEffect(() => {
    // Any context/provider change invalidates an unsent preview, never silently broadens it.
    generation.current += busy.current ? 0 : 1;
    setPrepared(null);
  }, [ctx?.body, ctx?.title, provider, scope]);

  useEffect(() => () => {
    generation.current++;
    streamRef.current?.abort();
  }, []);

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

  const dropEmptyTail = (id: string) => updateMessages(id, (prev) =>
    prev.at(-1)?.role === "assistant" && !prev.at(-1)?.content ? prev.slice(0, -1) : prev);

  // First click is local-only retrieval. Nothing reaches a provider until confirmSend.
  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy.current) return;
    if (!provider) {
      setError("尚未添加模型：请点击右上角 ⚙ 打开 AI 模型设置，从预设或自定义添加并选中一个模型。");
      return;
    }
    if (!ready) return;
    if (text.length > 12000) { setError("问题最多 12000 字，请缩短后重试。"); return; }
    busy.current = true;
    const ticket = ++generation.current;
    const identity = currentIdentity;
    setPreparing(true);
    setPrepared(null);
    setError(null);
    setInput(text);
    try {
      const root = await ipc.libraryRoot();
      if (!sameRoot(root.path, rootPath)) throw new Error("资料库已切换，请重新打开问 AI 窗口。");
      if (imageMode && scope === "library") throw new Error("画图模型仅支持当前文章范围，请切换范围或文字模型。");
      const sources = scope === "library"
        ? retrieveSources((await ipc.scanLibrary()).articles, text)
        : articleSources(ctx, imageMode);
      if (ticket !== generation.current || identityRef.current !== identity) return;
      setPrepared({ text, scope, sources, provider: { ...provider },
        history: imageMode ? [] : requestHistory(msgs, scope),
        ...(imageMode ? { imagePrompt: [text, ...sources.map((s) => `文章《${s.title}》主题参考：\n${s.snippet}`)].join("\n\n") } : {}),
      });
    } catch (e) {
      if (ticket === generation.current) setError(String(e));
    } finally {
      if (ticket === generation.current) { busy.current = false; setPreparing(false); }
    }
  };

  const confirmSend = async () => {
    if (!prepared || busy.current || !ready) return;
    busy.current = true;
    setPreparing(true);
    const request = prepared;
    const id = activeId;
    const identity = currentIdentity;
    const ticket = ++generation.current;
    const valid = () => ticket === generation.current && identityRef.current === identity;
    try {
      const root = await ipc.libraryRoot();
      if (!valid()) return;
      if (!sameRoot(rootPath, root.path)) throw new Error("资料库已切换，已取消发送。");
      setPrepared(null);
      setInput("");
      setError(null);
      setPreparing(false);
      setStreaming(true);
      const meta = { scope: request.scope, sources: request.sources.map((s) => ({ ...s, snippet: "" })),
        provider: `${request.provider.name} · ${request.provider.model}` };
      updateMessages(id, (prev) => [...prev.slice(-(MAX_MESSAGES - 2)),
        { role: "user", content: request.text, scope: request.scope },
        { role: "assistant", content: "", ...meta }]);
      const finish = (message?: string) => {
        if (!valid()) return;
        generation.current++;
        busy.current = false;
        setStreaming(false);
        streamRef.current = null;
        if (message) setError(message);
        dropEmptyTail(id);
      };
      const onDelta = (text: string) => {
        if (!valid()) return;
        updateMessages(id, (prev) => {
          const last = prev.at(-1);
          if (last?.role !== "assistant") return prev;
          const content = last.content + text;
          return [...prev.slice(0, -1), { ...last, content: request.imagePrompt ? content : content.slice(0, 60000) }];
        });
      };
      const options = { ...request.provider, onDelta, onError: (e: string) => finish(e), onDone: () => finish() };
      streamRef.current = request.imagePrompt
        ? generateImage({ ...options, prompt: request.imagePrompt })
        : streamChat({ ...options, messages: [
          { role: "system", content: learningPrompt(request.scope, request.sources) },
          ...request.history, { role: "user", content: request.text },
        ] });
    } catch (e) {
      if (valid()) { busy.current = false; setPreparing(false); setStreaming(false); setError(String(e)); }
    }
  };

  const abort = () => {
    generation.current++;
    streamRef.current?.abort();
    streamRef.current = null;
    busy.current = false;
    setStreaming(false);
    setPreparing(false);
    setPrepared(null);
    if (activeId) dropEmptyTail(activeId);
  };

  const newChat = () => {
    if (!rootPath) return;
    abort();
    const session: AiSession = { id: crypto.randomUUID(), rootPath, articleRel,
      title: `${ctx?.title || "自由会话"} · ${new Date().toLocaleString()}`, updatedAt: Date.now(), messages: [] };
    updateSessions((prev) => [session, ...prev].slice(0, 24));
    setActiveId(session.id);
    setError(null);
    setInput("");
    setSavedNote(null);
    inputRef.current?.focus();
  };

  const openArticle = async (rel: string) => {
    try {
      const root = await ipc.libraryRoot();
      if (!sameRoot(rootPath, root.path)) throw new Error("资料库已切换，无法打开此来源。");
      await emit("kv:open-article", { rel });
    } catch (e) { setError(String(e)); }
  };
  const saveNote = async (answer: LearningMessage) => {
    if (!active || !ready || saveBusy.current || streaming) return;
    saveBusy.current = true;
    setSaving(true);
    setError(null);
    setSavedNote(null);
    const identity = currentIdentity;
    try {
      const rel = await saveAnswerNote(ipc, active.rootPath, ctx?.secId || articleRel.split("/")[0],
        `AI 笔记 - ${ctx?.title || "学习问答"}`, answer);
      if (identityRef.current === identity) setSavedNote(rel);
    } catch (e) { setError(String(e)); }
    finally { saveBusy.current = false; setSaving(false); }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  // 点击 AI 回复里的图片 → 灯箱放大
  const onMsgsClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest?.(".ai-md a");
    if (anchor instanceof HTMLAnchorElement && anchor.href.startsWith("https://knowledge-vault.invalid/")) {
      e.preventDefault();
      const index = Number(anchor.closest("[data-message]")?.getAttribute("data-message"));
      const rel = sourceRel(anchor.href, msgs[index]?.sources ?? []);
      if (rel) void openArticle(rel);
      else setError("该引用不是本次提供的来源，无法打开。");
      return;
    }
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
          value={provider?.id ?? ""}
          onChange={(e) => useAi.getState().setActive(e.target.value)}
        >
          {providers.length === 0 && <option value="">未添加模型</option>}
          {!provider && providers.length > 0 && <option value="">未选择模型</option>}
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

      <div className="ai-window-ctx" title={rootPath ? `${rootPath} ${articleRel}` : ""}>
        <span className="ai-ctx-scope" title="回答的资料范围">
          <select value={scope} onChange={(e) => setScope(e.target.value as ContextScope)}
            disabled={preparing || streaming} aria-label="上下文范围">
            <option value="article" disabled={!ctx?.title}>当前文章</option>
            <option value="library">资料库检索</option>
          </select>
        </span>
        {ctx?.title
          ? `正在阅读：《${ctx.title}》`
          : "主窗口未打开文章，直接提问即可"}
      </div>

      <div className="ai-sessions-bar">
        <select aria-label="历史会话" value={activeId}
          onChange={(e) => { abort(); setActiveId(e.target.value); setSavedNote(null); }}
          disabled={!scopedSessions.length}>
          {scopedSessions.length ? scopedSessions.map((s) => (
            <option key={s.id} value={s.id}>{`${s.title} · ${new Date(s.updatedAt).toLocaleString()}`}</option>
          )) : <option>{rootPath ? "暂无会话" : "正在连接主窗口…"}</option>}
        </select>
        <button className="ai-icon-btn" title="新建会话" onClick={newChat} disabled={!rootPath}>＋</button>
        <button className="ai-icon-btn danger" title="删除当前会话"
          onClick={() => { if (!active || busy.current) return; updateSessions((prev) => prev.filter((s) => s.id !== active.id)); setActiveId(""); }}>
          🗑
        </button>
        <span className="ai-storage-state" title={storageError ?? undefined}>
          {storageError ? "⚠ 会话未持久化" : ""}
        </span>
      </div>

      <div className="ai-msgs scroll-thin" ref={listRef} onClick={onMsgsClick}>
        {!rootPath && (
          <div className="ai-empty"><p>正在连接主窗口获取资料库…</p></div>
        )}
        {msgs.length === 0 && !error && rootPath && (
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
          const done = !streaming || !isLast;
          return (
            <div className="ai-msg ai" key={i} data-message={i}>
              {m.content ? (
                <div
                  className="ai-md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownLite(m.content) }}
                />
              ) : null}
              {done && (
                <div className="ai-msg-meta">
                  {m.provider ? <span className="ai-msg-provider">{m.provider}</span> : null}
                  {m.sources?.length ? (
                    <span className="ai-msg-sources">来源：
                      {m.sources.map((s, n) => (
                        <button key={s.rel} onClick={() => openArticle(s.rel)}>{n + 1}. {s.title}</button>
                      ))}
                    </span>
                  ) : null}
                  {m.role === "assistant" && done ? (
                    <button className="ai-save-note" disabled={saving}
                      onClick={() => saveNote(m)}>{saving ? "保存中…" : "保存为笔记"}</button>
                  ) : null}
                  {savedNote && isLast ? <span className="ai-saved-note">已保存 {savedNote}</span> : null}
                </div>
              )}
              {isLast && streaming && (
                <span className="ai-cursor" aria-hidden>
                  ▍
                </span>
              )}
            </div>
          );
        })}

        {prepared && (
          <div className="ai-preview">
            <div className="ai-preview-row">
              <span className="ai-preview-label">模型</span>
              <span>{prepared.provider.name} · {prepared.provider.model}</span>
            </div>
            <div className="ai-preview-row">
              <span className="ai-preview-label">范围</span>
              <span>{prepared.scope === "article" ? "当前文章" : "资料库检索（本地关键词匹配前 5 篇）"}</span>
            </div>
            <div className="ai-preview-row">
              <span className="ai-preview-label">发送来源</span>
              {prepared.sources.length ? (
                <ol className="ai-preview-sources">
                  {prepared.sources.map((s, i) => (
                    <li key={s.rel} title={textOnly(s.snippet).slice(0, 400)}>{i + 1}. {s.title}</li>
                  ))}
                </ol>
              ) : <span>无（将提示模型不要编造依据）</span>}
            </div>
            <div className="ai-preview-actions">
              <button className="ai-confirm" onClick={() => void confirmSend()} disabled={preparing}>发送</button>
              <button onClick={() => { setPrepared(null); busy.current = false; }}>取消</button>
            </div>
          </div>
        )}

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
