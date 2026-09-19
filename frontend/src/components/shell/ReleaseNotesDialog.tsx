import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdownLite } from "../../lib/md-lite";
import type { UpdateInfo } from "../../lib/ipc";

/**
 * 应用内查看 Release Notes：Markdown 渲染（md-lite，先转义再打标记，防注入）。
 * 点击正文里的链接走系统浏览器打开，不让 WebView 整页跳转。
 */
export function ReleaseNotesDialog({
  info,
  onClose,
  onInstall,
  installLabel = "立即更新",
}: {
  info: UpdateInfo;
  onClose: () => void;
  onInstall?: () => void;
  installLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);

  // markdown 里的外链交系统浏览器；md-lite 产出的 <a> 带 href，原生点击会整页跳转
  const onBodyClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest?.("a");
    if (anchor instanceof HTMLAnchorElement && anchor.href.startsWith("http")) {
      e.preventDefault();
      void openUrl(anchor.href);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="release-notes-dialog"
      aria-label={`v${info.latest} 更新内容`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="release-notes-layout">
        <header className="release-notes-head">
          <h2>v{info.latest} 更新内容 <small>当前 v{info.current}</small></h2>
          <button className="ai-icon-btn" aria-label="关闭" title="关闭" onClick={onClose}>✕</button>
        </header>
        <div
          className="release-notes-body ai-md scroll-thin"
          onClick={onBodyClick}
          // md-lite 先整体转义再打标记，输出可信
          dangerouslySetInnerHTML={{ __html: renderMarkdownLite(info.notes || "本次更新未提供说明。") }}
        />
        <footer className="release-notes-foot">
          <button type="button" className="update-link" onClick={() => openUrl(info.releaseUrl)}>
            在 GitHub 查看发布页
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>关闭</button>
          {onInstall && (
            <button type="button" className="action-primary" onClick={onInstall}>{installLabel}</button>
          )}
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
