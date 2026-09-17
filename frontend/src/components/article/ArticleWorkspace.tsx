import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import { vault, errorMessage, type ArticleLink, type RecoveryEntry, type Metadata } from "../../lib/vault";
import { flushPending } from "../../lib/save-coordinator";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { useLearning, learningFor, defaultReading, type LearningStatus } from "../../store/learning";
import type { ArticleFileDto } from "../../lib/types";

export function ArticleWorkspace({ rel, reload }: { rel: string; reload: (file: ArticleFileDto) => void }) {
  const root = useLibrary((s) => s.root?.path ?? "");
  const data = useLibrary((s) => s.data);
  const learning = useLearning((s) => s.vaults);
  const record = learningFor(root, learning).articles[rel] ?? defaultReading;
  const [tab, setTab] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<ArticleFileDto | null>(null);
  const [metadata, setMetadata] = useState<Metadata>({ title: "", summary: "", order: 999, tags: [] });
  const [target, setTarget] = useState(rel);
  const [history, setHistory] = useState<RecoveryEntry[]>([]);
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null);
  const [links, setLinks] = useState<ArticleLink[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const open = (name: string) => void run(async () => {
    await flushPending();
    const current = await ipc.readArticle(rel);
    setFile(current); setMetadata(current); setTarget(rel); setPreview(null); setTab(name);
    if (name === "history") setHistory(await vault.history(rel));
    if (name === "links") { const result = await vault.links(); setLinks(result.links); setWarnings(result.warnings); }
  });
  useEffect(() => {
    if (!root) return;
    useLearning.getState().update(root, rel, { visited: Date.now() });
  }, [root, rel]);
  const title = (path: string) => data?.articles.find((a) => a.rel === path)?.title ?? path;
  return <section className="article-workspace">
    <div className="workspace-actions">
      <button onClick={() => useLearning.getState().update(root, rel, { favorite: !record.favorite })}>{record.favorite ? "★ 已收藏" : "☆ 收藏"}</button>
      <select aria-label="学习状态" value={record.status} onChange={(e) => useLearning.getState().update(root, rel, { status: e.target.value as LearningStatus })}>
        <option value="unread">未学</option><option value="learning">学习中</option><option value="review">待复习</option><option value="mastered">已掌握</option>
      </select>
      <button disabled={busy} onClick={() => open("metadata")}>整理文章</button>
      <button disabled={busy} onClick={() => open("history")}>历史版本</button>
      <button disabled={busy} onClick={() => open("links")}>文章关联</button>
      <button onClick={() => { setTab("review"); setAnswer(window.getSelection()?.toString() ?? ""); }}>制作复习卡</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {tab && <div className="workspace-panel">
      <div className="workspace-actions"><strong>{{ metadata: "文章整理", history: "历史版本", links: "文章关联", review: "复习卡片" }[tab]}</strong><button disabled={busy} onClick={() => setTab("")}>收起</button></div>
      {tab === "metadata" && file && <>
        <label>标题<input value={metadata.title} onChange={(e) => setMetadata({ ...metadata, title: e.target.value })} /></label>
        <label>摘要<input value={metadata.summary} onChange={(e) => setMetadata({ ...metadata, summary: e.target.value })} /></label>
        <label>标签（逗号分隔）<input value={metadata.tags.join(", ")} onChange={(e) => setMetadata({ ...metadata, tags: e.target.value.split(/[,，]/).map((t) => t.trim()) })} /></label>
        <label>排序<input type="number" value={metadata.order} onChange={(e) => setMetadata({ ...metadata, order: Number(e.target.value) })} /></label>
        <button disabled={busy} onClick={() => void run(async () => {
          await flushPending();
          const updated = await vault.metadata(rel, { ...metadata, tags: metadata.tags.filter(Boolean) }, file.revision);
          reload(updated); setFile(updated); await useLibrary.getState().rescan(); setTab("");
        })}>保存元信息</button>
        <label>移动到（板块/分组/文件.md）<input value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <p>目标目录须已存在。有入链或不能安全改写的链接时会拒绝移动，原文件不会被覆盖。</p>
        <button disabled={busy || target === rel} onClick={() => void run(async () => {
          await flushPending();
          const result = await vault.move(rel, target, file.revision);
          useLearning.getState().move(root, rel, result.article.rel);
          await useLibrary.getState().rescan();
          await useNav.getState().openArticle(result.article.rel, result.article.rel.split("/")[0]);
        })}>移动文章</button>
      </>}
      {tab === "history" && <>
        <p>恢复前会保存当前版本；历史记录保存在知识库的 .kv 目录。</p>
        {!history.length && <p>尚无历史版本，首次修改后会保留旧版本。</p>}
        {history.map((entry) => <div className="workspace-row" key={entry.id}><span>{new Date(entry.createdMs).toLocaleString()} · {entry.bytes} 字节</span>
          <button disabled={busy} onClick={() => void run(async () => { const result = await vault.readHistory(entry.id); setPreview({ id: entry.id, content: result.content }); })}>查看</button></div>)}
        {preview && <><pre className="workspace-preview">{preview.content}</pre><button disabled={busy} onClick={() => void run(async () => {
          await flushPending();
          const updated = await vault.restoreHistory(preview.id, file!.revision);
          reload(updated); setFile(updated); setHistory(await vault.history(rel)); setPreview(null); await useLibrary.getState().rescan();
        })}>确认恢复这个版本</button></>}
      </>}
      {tab === "links" && <>
        <h4>引用本文</h4>
        {links.filter((l) => l.targetRel === rel && l.kind === "link").map((l, i) => <button key={i} onClick={() => void useNav.getState().openArticle(l.sourceRel)}>{title(l.sourceRel)}</button>)}
        {!links.some((l) => l.targetRel === rel && l.kind === "link") && <p>尚无已识别的反向链接。</p>}
        <h4>本文引用</h4>
        {links.filter((l) => l.sourceRel === rel).map((l, i) => <div className="workspace-row" key={i}>
          {l.exists && l.targetRel?.endsWith(".md") ? <button onClick={() => void useNav.getState().openArticle(l.targetRel!)}>{title(l.targetRel)}</button> : <span>{l.destination}</span>}
          {l.exists === false && <strong>链接已失效</strong>}
        </div>)}
        {!!warnings.length && <details><summary>扫描范围说明（{warnings.length} 项）</summary>{warnings.slice(0, 30).map((w) => <p key={w}>{w}</p>)}</details>}
      </>}
      {tab === "review" && <>
        <label>问题<textarea value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
        <label>答案<textarea value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
        <button disabled={!question.trim() || !answer.trim()} onClick={() => { useLearning.getState().addCard(root, rel, question, answer); setQuestion(""); setAnswer(""); setTab(""); }}>加入复习队列</button>
      </>}
    </div>}
  </section>;
}
