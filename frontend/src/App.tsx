import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onLibraryChanged } from "./lib/ipc";
import { flushPending, hasPendingWork } from "./lib/save-coordinator";
import { useLibrary } from "./store/library";
import { useNav } from "./store/nav";
import { useSettings } from "./store/settings";
import { BASE_FONT_SCALE } from "./store/settings";
import { Sidebar } from "./components/shell/Sidebar";
import { SidebarDivider } from "./components/shell/SidebarDivider";
import { HomePage } from "./components/pages/HomePage";
import { SectionPage } from "./components/pages/SectionPage";
import { ArticlePage } from "./components/pages/ArticlePage";
import { SearchPage } from "./components/pages/SearchPage";
import { AiSettings } from "./components/ai/AiSettings";

export function App() {
  const fontScale = useSettings((s) => s.fontScale);
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  const { load, rescan, loading, error, root, data } = useLibrary();
  const view = useNav((s) => s.view);
  const query = useNav((s) => s.query);

  useEffect(() => {
    void load();
  }, [load]);

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

  // 关窗前先落盘。无未保存内容时不拦截，直接走原生关闭；
  // 有未保存内容时限时落盘，再延迟销毁窗口（在关闭回调内同步 destroy 会卡住窗口）。
  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onCloseRequested(async (event) => {
      if (!hasPendingWork()) return;
      event.preventDefault();
      try {
        await Promise.race([
          flushPending(),
          new Promise((resolve) => window.setTimeout(resolve, 1500)),
        ]);
      } finally {
        window.setTimeout(() => {
          void win.destroy();
        }, 0);
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
        {query.trim()
          ? <SearchPage />
          : view.name === "home"
            ? <HomePage />
            : view.name === "section"
              ? <SectionPage sectionId={view.id} />
              : <ArticlePage key={view.rel} rel={view.rel} />}
      </main>
      {root && !root.writable && (
        <div className="ro-banner">知识库目录只读，修改不会被保存（{root.source}）</div>
      )}
      <AiSettings />
    </div>
  );
}
