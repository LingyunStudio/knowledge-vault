import { useState } from "react";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { learningFor, useLearning } from "../../store/learning";
import { vault, errorMessage, type RecoveryEntry } from "../../lib/vault";
import { flushPending } from "../../lib/save-coordinator";

export function LearningDashboard() {
  const root = useLibrary((s) => s.root?.path ?? "");
  const data = useLibrary((s) => s.data);
  const state = useLearning();
  const saved = learningFor(root, state.vaults);
  const [trash, setTrash] = useState<RecoveryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const articles = data?.articles ?? [];
  const recent = articles.filter((a) => saved.articles[a.rel]?.visited).sort((a, b) => saved.articles[b.rel].visited - saved.articles[a.rel].visited).slice(0, 5);
  const favorites = articles.filter((a) => saved.articles[a.rel]?.favorite);
  const due = saved.cards.filter((c) => c.due <= Date.now());
  const card = due[0];
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <section className="learning-dashboard workspace-panel">
    <div className="workspace-actions"><h2>我的学习</h2><button disabled={busy} onClick={() => void run(async () => setTrash(trash ? null : await vault.trash()))}>回收站</button></div>
    {(error || state.error) && <p role="alert">{error || state.error}</p>}
    <div className="learning-columns">
      <div><h3>继续阅读</h3>{recent.length ? recent.map((a) => <button key={a.rel} onClick={() => void useNav.getState().openArticle(a.rel, a.secId, a.group)}>{a.title}</button>) : <p>打开文章后会出现在这里。</p>}</div>
      <div><h3>收藏</h3>{favorites.length ? favorites.map((a) => <button key={a.rel} onClick={() => void useNav.getState().openArticle(a.rel, a.secId, a.group)}>{a.title}</button>) : <p>在文章工具栏收藏常用内容。</p>}</div>
    </div>
    <h3>待复习 · {due.length}</h3>
    {card ? <div className="review-card"><p>{card.question}</p>
      <button onClick={() => void useNav.getState().openArticle(card.rel)}>查看来源文章</button>
      {revealed === card.id ? <><pre>{card.answer}</pre><button onClick={() => { state.reviewCard(root, card.id, false); setRevealed(null); }}>还不会 · 10 分钟后</button><button onClick={() => { state.reviewCard(root, card.id, true); setRevealed(null); }}>记住了 · 延后复习</button></> : <button onClick={() => setRevealed(card.id)}>显示答案</button>}
    </div> : <p>目前没有到期卡片，可在文章中制作复习卡。</p>}
    {trash && <div><h3>回收站</h3><p>恢复到原路径，不会覆盖现有文章。</p>{!trash.length && <p>回收站为空。</p>}
      {trash.map((entry) => <div key={entry.id} className="workspace-row"><span>{entry.rel} · {new Date(entry.createdMs).toLocaleString()}</span>
        <button disabled={busy} onClick={() => void run(async () => { await flushPending(); await vault.restoreTrash(entry.id); setTrash(await vault.trash()); await useLibrary.getState().rescan(); })}>恢复</button></div>)}
    </div>}
  </section>;
}
