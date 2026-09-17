import { useEffect, useRef } from "react";
import type { Crepe } from "@milkdown/crepe";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createCrepe } from "../../editor/crepe";
import { resolveMdLink, isExternal } from "../../lib/links";
import { useNav } from "../../store/nav";
import { useLibrary } from "../../store/library";

export interface TocHeading {
  level: number;
  text: string;
  el: HTMLElement;
}

interface CrepeEditorProps {
  body: string;
  rel: string;
  onChange: (markdown: string) => void;
  registerGetter: (fn: (() => string) | null) => void;
  onHeadings: (headings: TocHeading[]) => void;
}

/**
 * 永久 WYSIWYG：阅读态与编辑态是同一个 contenteditable DOM，
 * 没有模式切换、没有源码视图。父组件以 key={rel} 控制整体重挂。
 */
export function CrepeEditor({ body, rel, onChange, registerGetter, onHeadings }: CrepeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ rel, onChange, onHeadings });
  propsRef.current = { rel, onChange, onHeadings };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let crepe: Crepe | null = null;
    let dispose: (() => void) | null = null;
    let destroyed = false;
    let raf = 0;

    const scanHeadings = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        markListRuns();
        const nodes = host.querySelectorAll<HTMLElement>("h1, h2, h3");
        const hs: TocHeading[] = [];
        nodes.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) {
            hs.push({
              level: Number(el.tagName[1]),
              text,
              el,
            });
          }
        });
        propsRef.current.onHeadings(hs);
      });
    };

    // 彩虹列表：给每个列表项块标记它在连续同级块中的序号（mod 7）
    const markListRuns = () => {
      host
        .querySelectorAll<HTMLElement>(".milkdown-list-item-block")
        .forEach((block) => {
          let idx = 0;
          let prev = block.previousElementSibling;
          while (
            prev &&
            prev.classList.contains("milkdown-list-item-block")
          ) {
            idx += 1;
            prev = prev.previousElementSibling;
          }
          block.dataset.ri = String(idx % 7);
        });
    };

    const observer = new MutationObserver(scanHeadings);
    observer.observe(host, { childList: true, subtree: true, characterData: true });

    // 内链导航：.md 相对路径 → 库内文章
    const navigateInternal = (href: string) => {
      const target = resolveMdLink(propsRef.current.rel, href);
      if (!target) return;
      const data = useLibrary.getState().data;
      const art = data?.articles.find((a) => a.rel === target);
      void useNav.getState().openArticle(target, art?.secId ?? target.split("/")[0], art?.group ?? null);
    };

    void createCrepe({
      root: host,
      defaultValue: body,
      onMarkdownChange: (md) => propsRef.current.onChange(md),
      openInternalLink: navigateInternal,
    }).then((created) => {
      if (destroyed) {
        void created.crepe.destroy();
        created.dispose();
        return;
      }
      crepe = created.crepe;
      dispose = created.dispose;
      registerGetter(() => created.crepe.getMarkdown());
      // 等首屏排版完成后采集 TOC
      setTimeout(scanHeadings, 120);
    });

    // 链接拦截：.md 内链 Ctrl/⌘+点击导航；外链系统浏览器打开
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      if (isExternal(href)) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          void openUrl(href);
        }
        return;
      }
      if (resolveMdLink(propsRef.current.rel, href)) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) navigateInternal(href);
      }
    };
    host.addEventListener("click", onClick, true);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      host.removeEventListener("click", onClick, true);
      registerGetter(null);
      dispose?.();
      void crepe?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="crepe-host article-body" spellCheck={false} />;
}
