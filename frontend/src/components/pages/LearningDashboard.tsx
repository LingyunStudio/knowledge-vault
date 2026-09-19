import { useState } from "react";
import { LearningCalendar } from "./LearningCalendar";
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
  const [choice, setChoice] = useState<{ id: string; index: number } | null>(null);
  const articles = data?.articles ?? [];
  const recent = articles.filter((a) => saved.articles[a.rel]?.visited).sort((a, b) => saved.articles[b.rel].visited - saved.articles[a.rel].visited);
  const favorites = articles.filter((a) => saved.articles[a.rel]?.favorite);
  const due = saved.cards.filter((c) => c.due <= Date.now());
  const card = due[0];
  const showing = !!card && revealed === card.id;
  const picked = choice?.id === card?.id ? choice?.index : undefined;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const review = (remembered: boolean) => {
    if (!card) return;
    state.reviewCard(root, card.id, remembered); setRevealed(null); setChoice(null);
  };
  return <section className="learning-dashboard workspace-panel">
    <header className="learning-header"><div><span className="learning-eyebrow">YOUR LEARNING SPACE</span><h2>学习</h2><p>回到上次的思路，让新知识留下来。</p></div>
      <button disabled={busy} onClick={() => void run(async () => setTrash(trash ? null : await vault.trash()))}>回收站</button>
    </header>
    <div className="learning-stats" aria-label="学习概览">
      <div><strong>{recent.length}</strong><span>阅读过的文章</span></div><div><strong>{favorites.length}</strong><span>收藏文章</span></div><div><strong>{due.length}</strong><span>今日待复习</span></div>
    </div>
    {(error || state.error) && <p role="alert">{error || state.error}</p>}
    <div className="learning-overview">
      <div className="learning-columns">
        <section className="learning-list-panel"><header><h3>继续阅读</h3><span>{recent.length} 篇</span></header>
          <div className="learning-article-list" tabIndex={0} role="region" aria-label="继续阅读列表">
            {recent.length ? recent.map((a) => <button key={a.rel} onClick={() => void useNav.getState().openArticle(a.rel, a.secId, a.group)}><span>{a.title}</span><small className="learning-chip">{data?.sections.find((s) => s.id === a.secId)?.name ?? a.secId}</small></button>) : <p className="learning-empty">从知识库打开一篇文章，下一次在这里继续。</p>}
          </div>
        </section>
        <section className="learning-list-panel"><header><h3>收藏</h3><span>{favorites.length} 篇</span></header>
          <div className="learning-article-list" tabIndex={0} role="region" aria-label="收藏文章列表">
            {favorites.length ? favorites.map((a) => <button key={a.rel} onClick={() => void useNav.getState().openArticle(a.rel, a.secId, a.group)}><span>{a.title}</span><small className="learning-chip">{data?.sections.find((s) => s.id === a.secId)?.name ?? a.secId}</small></button>) : <p className="learning-empty">收藏值得反复阅读的文章，建立自己的常用清单。</p>}
          </div>
        </section>
      </div>
      <section className="learning-review-panel">
        <header><div><span className="learning-eyebrow">DAILY REVIEW</span><h3>待复习 · {due.length}</h3></div><span className="review-type">{card?.type === "choice" ? "选择题" : "简答题"}</span></header>
        <div className="learning-review-body">
          {card ? <div className="review-card" key={card.id}>
            <p className="review-question">{card.question}</p>
            <button className="review-source" onClick={() => void useNav.getState().openArticle(card.rel)}>查看来源文章</button>
            {card.type === "choice" && <div className="review-options" role="group" aria-label="选择答案">
              {card.options?.map((option, index) => <button key={index} aria-pressed={picked === index} disabled={showing}
                className={showing && index === card.correctIndex ? "correct" : showing && picked === index ? "incorrect" : ""}
                onClick={() => setChoice({ id: card.id, index })}><b>{String.fromCharCode(65 + index)}</b><span>{option}</span></button>)}
            </div>}
            {showing ? <>
              {card.type === "choice" && <p role="status" className="review-result">{picked === card.correctIndex ? "答对了" : "再巩固一下"} · 正确答案 {String.fromCharCode(65 + (card.correctIndex ?? 0))}</p>}
              <pre>{card.answer}</pre>
              <div className="workspace-actions"><button onClick={() => review(false)}>还不会 · 10 分钟后</button><button className="action-primary" onClick={() => review(true)}>记住了 · 延后复习</button></div>
            </> : <button className="action-primary review-submit" disabled={card.type === "choice" && picked === undefined} onClick={() => setRevealed(card.id)}>{card.type === "choice" ? "提交答案" : "显示答案"}</button>}
          </div> : <div className="learning-empty review-empty"><span aria-hidden="true">✓</span><h3>今天的复习已完成</h3><p>目前没有到期卡片。可以用 AI 制作新卡片，也可以继续阅读。</p></div>}
        </div>
      </section>
    </div>
    <LearningCalendar activity={saved.activity} />
    {trash && <section className="learning-trash"><h3>回收站</h3><p>恢复到原路径，不会覆盖现有文章。</p>{!trash.length && <p>回收站为空。</p>}
      {trash.map((entry) => <div key={entry.id} className="workspace-row"><span>{entry.rel} · {new Date(entry.createdMs).toLocaleString()}</span>
        <button disabled={busy} onClick={() => void run(async () => { await flushPending(); await vault.restoreTrash(entry.id); setTrash(await vault.trash()); await useLibrary.getState().rescan(); })}>恢复</button></div>)}
    </section>}
  </section>;
}
