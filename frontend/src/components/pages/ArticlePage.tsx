import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc, type WriteError } from "../../lib/ipc";
import type { ArticleFileDto } from "../../lib/types";
import { composeFile, setTitle } from "../../lib/frontmatter";
import { readingMinutes } from "../../lib/format";
import { emitAiContext, openAskAIWindow } from "../../lib/ai-window";
import {
  isSelfSavedEvent,
  markSelfSaved,
  registerFlusher,
  setPendingDirty,
} from "../../lib/save-coordinator";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { CrepeEditor, type TocHeading } from "../article/CrepeEditor";
import { PrevNext } from "../article/PrevNext";
import { ReadProgress } from "../article/ReadProgress";
import { SaveStatus, type SaveState } from "../article/SaveStatus";
import { Toc } from "../article/Toc";

type SaveStatusType = SaveState;
type Banner =
  | { kind: "external"; disk: ArticleFileDto }
  | { kind: "conflict"; disk: ArticleFileDto | null }
  | null;

const SAVE_DEBOUNCE_MS = 1200;
const normalizedRels = new Set<string>();

export function ArticlePage({ rel }: { rel: string }) {
  const data = useLibrary((s) => s.data);
  const openSection = useNav((s) => s.openSection);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveStatusType>("idle");
  const [banner, setBanner] = useState<Banner>(null);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [editorNonce, setEditorNonce] = useState(0);
  const [normalizedTip, setNormalizedTip] = useState(false);
  const [srcView, setSrcView] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyMarkdown = async () => {
    const md = mdRef.current;
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // 剪贴板 API 不可用时的兜底
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const titleElRef = useRef<HTMLDivElement>(null);
  const fmRawRef = useRef<string | null>(null);
  const mtimeRef = useRef(0);
  const mdRef = useRef("");
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const savedTimerRef = useRef<number | undefined>(undefined);
  const relRef = useRef(rel);
  relRef.current = rel;

  const secId = rel.split("/")[0];
  const section = data?.sections.find((s) => s.id === secId);

  // 文章上下文 → 问 AI 独立窗口：打开文章、每次落盘、收到请求时广播
  const emitCtx = useCallback(() => {
    emitAiContext({
      rel,
      title: titleElRef.current?.textContent ?? "",
      body: mdRef.current,
    });
  }, [rel]);

  useEffect(() => {
    emitCtx();
    let un: UnlistenFn | null = null;
    void listen("kv:ai-ctx-req", () => emitCtx()).then((f) => {
      un = f;
    });
    return () => {
      un?.();
    };
  }, [emitCtx]);

  const applyDisk = useCallback((disk: ArticleFileDto) => {
    fmRawRef.current = disk.fmRaw;
    mtimeRef.current = disk.mtimeMs;
    mdRef.current = disk.body;
    dirtyRef.current = false;
    setPendingDirty(false);
    setBody(disk.body);
    setTags(disk.tags);
    setReady(true);
    if (titleElRef.current) titleElRef.current.textContent = disk.title;
    setBanner(null);
    setSaveState("idle");
    setEditorNonce((n) => n + 1);
  }, []);

  // 初次加载
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    setBanner(null);
    setHeadings([]);
    setReady(false);
    ipc
      .readArticle(rel)
      .then((file) => {
        if (!alive) return;
        fmRawRef.current = file.fmRaw;
        mtimeRef.current = file.mtimeMs;
        mdRef.current = file.body;
        dirtyRef.current = false;
        setPendingDirty(false);
        setBody(file.body);
        setTags(file.tags);
        setSaveState("idle");
        setReady(true);
        requestAnimationFrame(() => {
          if (titleElRef.current) titleElRef.current.textContent = file.title;
        });
      })
      .catch((e) => alive && setLoadError(String(e)));
    return () => {
      alive = false;
    };
  }, [rel]);

  const doSave = useCallback(async (force: boolean) => {
    if (!dirtyRef.current) return;
    window.clearTimeout(timerRef.current);
    setSaveState("saving");
    const content = composeFile(fmRawRef.current, mdRef.current);
    const expected = force ? null : mtimeRef.current;
    try {
      const ok = await ipc.writeArticle(relRef.current, content, expected);
      mtimeRef.current = ok.mtimeMs;
      dirtyRef.current = false;
      setPendingDirty(false);
      markSelfSaved(relRef.current);
      const firstTime = !normalizedRels.has(relRef.current);
      normalizedRels.add(relRef.current);
      setNormalizedTip(firstTime);
      setSaveState("saved");
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => {
        setSaveState("idle");
        setNormalizedTip(false);
      }, 2500);
      emitCtx();
    } catch (e) {
      const err = e as WriteError;
      if (err && typeof err === "object" && err.kind === "conflict") {
        setBanner({ kind: "conflict", disk: err.disk ?? null });
      } else {
        setSaveState("error");
      }
    }
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void doSave(false), SAVE_DEBOUNCE_MS);
  }, [doSave]);

  const onMarkdownChange = useCallback(
    (md: string) => {
      mdRef.current = md;
      dirtyRef.current = true;
      setPendingDirty(true);
      setSaveState("editing");
      scheduleSave();
    },
    [scheduleSave],
  );

  const onTitleInput = useCallback(() => {
    const t = titleElRef.current?.textContent ?? "";
    fmRawRef.current = setTitle(fmRawRef.current, t);
    dirtyRef.current = true;
    setPendingDirty(true);
    setSaveState("editing");
    scheduleSave();
  }, [scheduleSave]);

  // 切换文章 / 关窗前 flush
  useEffect(() => {
    registerFlusher(async () => {
      window.clearTimeout(timerRef.current);
      if (dirtyRef.current) await doSave(true);
    });
    return () => registerFlusher(null);
  }, [doSave]);

  // Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doSave(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  // 外部修改
  useEffect(() => {
    const handler = (ev: Event) => {
      const files = (ev as CustomEvent).detail as { rel: string }[];
      const hit = files.length === 0 || files.some((f) => f.rel === relRef.current);
      if (!hit || isSelfSavedEvent(relRef.current)) return;
      void ipc.readArticle(relRef.current).then((disk) => {
        if (disk.mtimeMs === mtimeRef.current) return;
        if (dirtyRef.current) {
          setBanner({ kind: "external", disk });
        } else {
          applyDisk(disk);
        }
      });
    };
    window.addEventListener("kv:library-changed", handler);
    return () => window.removeEventListener("kv:library-changed", handler);
  }, [applyDisk]);

  if (loadError) {
    return <div className="center-note">文章读取失败：{loadError}</div>;
  }

  return (
    <>
      <ReadProgress />
      <Toc headings={headings} />
      <div className="article-scroll-inner">
        <div className="article-kicker">
          {section && (
            <span onClick={() => openSection(secId)}>
              {section.name}
              <span className="sep">/</span>
            </span>
          )}
          <SaveStatusWrapper state={saveState} normalizedTip={normalizedTip} />
          <span className="article-tools">
            <button
              className={srcView ? "on" : ""}
              title="查看 Markdown 源代码（编辑器状态保留）"
              onClick={() => setSrcView((v) => !v)}
            >
              {srcView ? "退出源码" : "源码"}
            </button>
            <button
              title="复制本文 Markdown（含未保存的修改）"
              onClick={() => void copyMarkdown()}
            >
              {copied ? "已复制 ✓" : "复制 Markdown"}
            </button>
          </span>
        </div>

        <div
          ref={titleElRef}
          className="article-title"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder="无标题"
          onInput={onTitleInput}
          onPaste={(e) => {
            e.preventDefault();
            const t = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, t);
          }}
        />

        <div className="article-meta">
          <span>约 {readingMinutes(body || mdRef.current)} 分钟</span>
          {tags.map((t) => (
            <span className="tag-chip" key={t}>
              {t}
            </span>
          ))}
        </div>
        <div className="article-rule" />

        {banner && (
          <div className="conflict-banner">
            <span>
              {banner.kind === "external"
                ? "文件已被外部修改。"
                : "保存时发现文件已被其他程序修改。"}
            </span>
            <span className="spacer" style={{ flex: 1 }} />
            {banner.disk && (
              <button onClick={() => applyDisk(banner.disk!)}>用磁盘版</button>
            )}
            <button
              className="primary"
              onClick={() => {
                setBanner(null);
                void doSave(true);
              }}
            >
              {banner.kind === "external" ? "保留我的并保存" : "强制覆盖保存"}
            </button>
          </div>
        )}

        {ready && (
          <div style={srcView ? { display: "none" } : undefined}>
            <CrepeEditor
              key={editorNonce}
              body={body}
              rel={rel}
              onChange={onMarkdownChange}
              registerGetter={() => {}}
              onHeadings={setHeadings}
            />
          </div>
        )}
        {ready && srcView && (
          <pre className="article-src scroll-thin">{mdRef.current}</pre>
        )}

        <PrevNext rel={rel} secId={secId} />
      </div>

      {/* 问 AI：独立原生窗口（可拖到应用外、任意方向缩放），由本页提供文章上下文 */}
      <button
        className="ai-fab"
        title="向 AI 提问（独立窗口）"
        onClick={() => void openAskAIWindow()}
      >
        <svg className="ai-fab-spark" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M10 3.5 12.3 9.7 18.5 12 12.3 14.3 10 20.5 7.7 14.3 1.5 12 7.7 9.7Z" fill="currentColor" />
          <path d="m19 2 1.1 2.9L23 6l-2.9 1.1L19 10l-1.1-2.9L15 6l2.9-1.1Z" fill="currentColor" opacity=".6" />
        </svg>
        <span>问 AI</span>
      </button>
    </>
  );
}

function SaveStatusWrapper({
  state,
  normalizedTip,
}: {
  state: SaveStatusType;
  normalizedTip: boolean;
}) {
  if (state === "saved" && normalizedTip) {
    return <span className="save-status saved">✓ 已保存（Markdown 排版已规范化）</span>;
  }
  return <SaveStatus state={state} />;
}
