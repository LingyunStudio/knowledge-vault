import { useEffect, useRef, useState } from "react";
import "../../styles/authoring-preview.css";
import { createCrepe, type CreatedCrepe } from "../../editor/crepe";

export function AuthoringPreview({ title, markdown, onClose, onApply, applyLabel, applyDisabled }: { title: string; markdown: string; onClose: () => void; onApply?: () => void; applyLabel?: string; applyDisabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<{ text: string; level: number; el: HTMLElement }[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    const element = host.current!;
    let disposed = false;
    let created: CreatedCrepe | undefined;
    const scan = () => {
      if (disposed) return;
      element.querySelectorAll<HTMLElement>(".milkdown-list-item-block").forEach((block) => {
        let i = 0;
        let previous = block.previousElementSibling;
        while (previous?.classList.contains("milkdown-list-item-block")) { i++; previous = previous.previousElementSibling; }
        block.dataset.ri = String(i % 7);
      });
      setHeadings(Array.from(element.querySelectorAll<HTMLElement>("h1,h2,h3")).map((el) => ({ el, text: el.textContent ?? "", level: Number(el.tagName[1]) })));
    };
    const observer = new MutationObserver(scan);
    void createCrepe({ root: element, defaultValue: markdown, readOnly: true, onMarkdownChange: () => {} }).then((result) => {
      if (disposed) { result.dispose(); void result.crepe.destroy(); return; }
      created = result; scan(); setReady(true);
      observer.observe(element, { subtree: true, childList: true, characterData: true });
    }).catch(() => { if (!disposed) setError("预览加载失败，草稿仍保留。请返回草稿查看或重试。"); });
    return () => { disposed = true; observer.disconnect(); created?.dispose(); void created?.crepe.destroy(); };
  }, [markdown]);
  return <dialog ref={dialog} className="authoring-preview" aria-labelledby="preview-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="preview-header"><div><span>草稿预览 · 尚未保存</span><h2 id="preview-title">{title}</h2></div><button type="button" aria-label="关闭预览" onClick={onClose}>返回审核 / 编辑</button></header>
    <div className="preview-layout">
      <nav className="preview-toc" aria-label="预览目录"><strong>目录</strong>{headings.length ? headings.map((h, index) => <button key={index} type="button" style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }} onClick={() => h.el.scrollIntoView({ block: "start" })}>{h.text}</button>) : <p>本文暂无标题目录</p>}</nav>
      <div ref={scroll} className="preview-scroll" tabIndex={0} aria-label="草稿阅读区域">
        <article className="article-scroll-inner">
          <div className="article-kicker">AI DRAFT · 只读预览</div><h1 className="article-title">{title}</h1>
          <div className="article-meta">约 {Math.max(1, Math.ceil(markdown.length / 500))} 分钟 · 审核确认后才保存</div><div className="article-rule" />
          {!ready && !error && <p role="status">正在排版预览…</p>}{error && <p role="alert">{error}</p>}
          <div ref={host} className="crepe-host article-body" onClickCapture={(event) => {
            const anchor = (event.target as HTMLElement).closest("a");
            if (anchor) { event.preventDefault(); event.stopPropagation(); }
          }} />
        </article>
      </div>
    </div>
    <footer className="preview-footer"><span>与文章页相同的排版 · 预览中的链接不会跳离草稿</span><div className="workspace-actions">{onApply && <button type="button" className="action-primary" disabled={applyDisabled} onClick={onApply}>{applyLabel ?? "确认应用"}</button>}<button type="button" aria-label="预览回到顶部" onClick={() => scroll.current?.scrollTo({ top: 0, behavior: "instant" })}>⌃ 回到顶部</button></div></footer>
  </dialog>;
}
