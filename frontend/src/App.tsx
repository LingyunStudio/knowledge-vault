import { useEffect, useState } from "react";
import { AiAuthoring } from "./components/ai/AiAuthoring";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { emitAiContext, useAiStoreStorageSync } from "./lib/ai-window";

import { onLibraryChanged } from "./lib/ipc";
import { flushPending, hasPendingWork } from "./lib/save-coordinator";
import { useLibrary } from "./store/library";
import { useNav } from "./store/nav";
import { useSettings } from "./store/settings";
import { BASE_FONT_SCALE } from "./store/settings";
import { Sidebar } from "./components/shell/Sidebar";
import { SidebarDivider } from "./components/shell/SidebarDivider";
import { HomePage } from "./components/pages/HomePage";
import { LearningDashboard } from "./components/pages/LearningDashboard";
import "./styles/workspace.css";
import { SectionPage } from "./components/pages/SectionPage";
import { ArticlePage } from "./components/pages/ArticlePage";
import { SearchPage } from "./components/pages/SearchPage";
import { AiSettings } from "./components/ai/AiSettings";

export function App() {
  const [authoringOpen, setAuthoringOpen] = useState(false);
  const fontScale = useSettings((s) => s.fontScale);
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  const tocWidth = useSettings((s) => s.tocWidth);
  const { load, rescan, loading, error, root, data } = useLibrary();
  const view = useNav((s) => s.view);
  const query = useNav((s) => s.query);
  const navError = useNav((s) => s.error);
  const past = useNav((s) => s.past);
  const future = useNav((s) => s.future);

  useEffect(() => {
    const un = listen<{ rel: string }>("kv:open-article", ({ payload }) => {
      const article = useLibrary.getState().data?.articles.find((a) => a.rel === payload.rel);
      if (article) void useNav.getState().openArticle(article.rel, article.secId, article.group);
    });
    return () => { void un.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (view.name === "article" && !query.trim()) return;
    const send = () => emitAiContext({ rel: "", title: "", body: "", rootPath: root?.path });
    send();
    const un = listen("kv:ai-ctx-req", send);
    return () => { void un.then((f) => f()); };
  }, [view, query, root?.path]);

  useEffect(() => {
    if (view.name === "article" && !query.trim()) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById("content-scroll");
      if (el) el.scrollTop = useNav.getState().restoreScroll ?? 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [view, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // 其他窗口（问 AI）修改模型设置时同步本窗口的 AI store
  useAiStoreStorageSync();

  // 字号、栏宽 → CSS 变量
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-scale",
      String(fontScale * BASE_FONT_SCALE),
    );
  }, [fontScale]);
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${sidebarWidth}px`);
  }, [sidebarWidth]);
  useEffect(() => {
    document.documentElement.style.setProperty("--toc-w", `${tocWidth}px`);
  }, [tocWidth]);

  // 文件变更：通知当前文章页 + 防抖重扫侧栏
  useEffect(() => {
    let timer: number | undefined;
    const un = onLibraryChanged((files) => {
      window.dispatchEvent(
        new CustomEvent("kv:library-changed", { detail: files }),
      );
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void rescan(), 500);
    });
    return () => {
      void un.then((f) => f());
      window.clearTimeout(timer);
    };
  }, [rescan]);

  // 保存未确认成功时必须保留窗口与编辑器中的内容。
  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onCloseRequested(async (event) => {
      if (!hasPendingWork()) return;
      event.preventDefault();
      try {
        await flushPending();
        if (!hasPendingWork()) window.setTimeout(() => {
          if (!hasPendingWork()) void win.destroy();
        }, 0);
      } catch (e) {
        useNav.setState({ error: e instanceof Error ? e.message : "保存失败，窗口已保留。" });
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  if (loading && !data) {
    return <div className="center-note">正在打开知识库…</div>;
  }
  if (error && !data) {
    return <div className="center-note">加载失败：{error}</div>;
  }

  const isArticle = view.name === "article";

  return (
    <div className="app">
      <Sidebar />
      <SidebarDivider />
      <main
        id="content-scroll"
        className={`content${isArticle ? " with-toc" : ""}`}
      >
        <nav className="workspace-nav" aria-label="浏览历史">
          <button disabled={!past.length} onClick={() => void useNav.getState().back()}>← 后退</button>
          <button disabled={!future.length} onClick={() => void useNav.getState().forward()}>前进 →</button>
          <button className="authoring-launch" disabled={!root?.writable} onClick={() => setAuthoringOpen(true)}>✦ AI 写作 / 制卡</button>
        </nav>
        {navError && <div className="conflict-banner" role="alert"><span>{navError}</span>
          <button onClick={() => useNav.getState().clearError()}>知道了</button></div>}
        {query.trim()
          ? <SearchPage />
          : view.name === "home"
            ? <HomePage />
            : view.name === "learning"
              ? <LearningDashboard />
              : view.name === "section"
                ? <SectionPage sectionId={view.id} />
                : <ArticlePage key={view.rel} rel={view.rel} />}
      </main>
      {root && !root.writable && (
        <div className="ro-banner">知识库目录只读，修改不会被保存（{root.source}）</div>
      )}
      <AiSettings />
      {authoringOpen && <AiAuthoring onClose={() => setAuthoringOpen(false)} />}
    </div>
  );
}
