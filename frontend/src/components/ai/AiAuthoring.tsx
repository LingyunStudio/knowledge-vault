import { useEffect, useRef, useState } from "react";
import { AuthoringPreview } from "./AuthoringPreview";
import { AuthoringTemplates } from "./AuthoringTemplates";
import { activeProvider, useAi } from "../../store/ai";
import { isImageModel } from "../../lib/ai-presets";
import { streamChat, type StreamHandle } from "../../lib/ai-client";
import { ipc } from "../../lib/ipc";
import { composeFile, setTitle } from "../../lib/frontmatter";
import { flushPending } from "../../lib/save-coordinator";
import { sameRoot } from "../../lib/ai-learning";
import { applyArticleEdit, authoringPrompt, parseArticleDraft, parseCardDrafts, type ArticleDraft, type AuthorMode, type CardDraft } from "../../lib/ai-authoring";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { useLearning } from "../../store/learning";
import type { ArticleFileDto } from "../../lib/types";
import "../../styles/ai-authoring.css";

const labels = { edit: "修改当前文章", new: "写新文章", cards: "制作复习卡" };
const message = (e: unknown) => e instanceof Error ? e.message : typeof e === "string" ? e : "保存失败，可能存在磁盘冲突；原稿仍在，请检查后重试。";

export function AiAuthoring({ onClose }: { onClose: () => void }) {
  const provider = useAi(activeProvider);
  const dialog = useRef<HTMLDialogElement>(null);
  const [target] = useState(() => {
    const view = useNav.getState().view;
    return { root: useLibrary.getState().root?.path ?? "", rel: view.name === "article" ? view.rel : "",
      section: view.name === "section" ? view.id : view.name === "article" ? view.rel.split("/")[0] : "" };
  });
  const sections = useLibrary((s) => s.data?.sections ?? []);
  const [mode, setMode] = useState<AuthorMode>(target.rel ? "edit" : "new");
  const [section, setSection] = useState(target.section || sections[0]?.id || "");
  const [cardType, setCardType] = useState<"choice" | "short">("choice");
  const [instruction, setInstruction] = useState("");
  const [baseline, setBaseline] = useState<ArticleFileDto | null>(null);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [cards, setCards] = useState<(CardDraft & { selected: boolean })[]>([]);
  const [raw, setRaw] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftEditor, setDraftEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedRel, setSavedRel] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const handle = useRef<StreamHandle | null>(null);
  const ticket = useRef(0);
  const locked = useRef(false);

  useEffect(() => {
    dialog.current?.showModal();
    return () => { ticket.current++; handle.current?.abort(); };
  }, []);
  const clear = () => { setPreviewOpen(false); setDraftEditor(false); setDraft(null); setCards([]); setRaw(""); setError(""); setNotice(""); setSavedRel(""); setAcknowledged(false); };
  const checkRoot = async () => {
    const root = await ipc.libraryRoot();
    if (!sameRoot(root.path, target.root)) throw new Error("知识库已变化，请关闭面板后重试。");
    if (!root.writable) throw new Error("当前知识库只读，不能应用内容。");
  };
  const stop = () => {
    ticket.current++; handle.current?.abort(); handle.current = null; locked.current = false;
    setBusy(false); setStreaming(false); setDraft(null); setCards([]); setError("生成已停止，未写入文章或复习卡。可复制下方未完成输出。");
  };
  const generate = async () => {
    if (locked.current) return;
    locked.current = true;
    const id = ++ticket.current;
    clear(); setBusy(true);
    let output = "";
    const fail = (e: unknown) => {
      if (id !== ticket.current) return;
      ticket.current++; handle.current?.abort(); locked.current = false;
      setBusy(false); setStreaming(false); setError(message(e));
    };
    try {
      if (!instruction.trim()) throw new Error("请先填写你的要求。");
      if (!provider) throw new Error("尚未添加模型：请在 AI 模型设置中从预设或自定义添加并选中一个模型。");
      if (!provider.model || !provider.baseUrl || isImageModel(provider.model)) throw new Error("请先在 AI 设置中选择可用的文本模型。");
      await checkRoot();
      await flushPending();
      const source = mode === "new" ? null : await ipc.readArticle(target.rel);
      if (id !== ticket.current) return;
      setBaseline(source);
      const messages = authoringPrompt(mode, instruction, source, cardType);
      setStreaming(true);
      handle.current = streamChat({ ...provider, messages,
        onDelta: (text) => {
          if (id !== ticket.current) return;
          output += text;
          if (output.length > 120000) { fail(new Error("输出超出长度限制，请缩小任务范围。")); return; }
          setRaw(output);
        },
        onError: (e) => fail(e),
        onDone: () => {
          if (id !== ticket.current) return;
          try {
            if (mode === "cards") setCards(parseCardDrafts(output, cardType).map((card) => ({ ...card, selected: true })));
            else setDraft(parseArticleDraft(output));
            setNotice("生成完成。请核对事实、链接和完整性，修改后确认应用。AI 内容可能不准确。");
            setPreviewOpen(true);
          } catch (e) { setError(message(e)); }
          ticket.current++; locked.current = false; handle.current = null; setBusy(false); setStreaming(false);
        },
      });
    } catch (e) { fail(e); }
  };
  const apply = async () => {
    if (locked.current || busy) return;
    locked.current = true; setBusy(true); setError("");
    let committed = false;
    try {
      await checkRoot();
      await flushPending();
      if (mode === "cards") {
        if (!baseline) throw new Error("缺少来源文章，请重新生成。");
        const current = await ipc.readArticle(baseline.rel);
        if (current.revision !== baseline.revision) throw new Error("来源文章已修改，请重新生成卡片。");
        const selected = parseCardDrafts(JSON.stringify({ cards: cards.filter((c) => c.selected).map(({ selected: _selected, ...card }) => card) }), cardType);
        const count = useLearning.getState().addCards(target.root, baseline.rel, selected);
        committed = true; setCards([]); setRaw(""); setNotice(`已加入 ${count} 张复习卡（重复卡片会跳过），可在学习页面复习。`);
      } else {
        const validated = parseArticleDraft(JSON.stringify(draft));
        let rel: string;
        if (mode === "edit") {
          if (!baseline) throw new Error("缺少文章原稿，请重新生成。");
          await applyArticleEdit(ipc, target.root, baseline, validated);
          rel = baseline.rel;
        } else {
          if (!sections.some((s) => s.id === section)) throw new Error("请选择存在的目标板块。");
          const stem = validated.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 45) || "AI文章";
          rel = `${section}/${stem}-${crypto.randomUUID()}.md`;
          await ipc.writeArticle(rel, composeFile(setTitle(null, validated.title), validated.body), null, "missing");
        }
        committed = true; setDraft(null); setRaw(""); setSavedRel(rel);
        setNotice(mode === "edit" ? "修改已保存；原文已保留在历史版本。" : `新文章已保存：${rel}`);
        window.dispatchEvent(new CustomEvent("kv:library-changed", { detail: [{ rel }] }));
        await useLibrary.getState().rescan();
      }
    } catch (e) {
      setError(`${committed ? "内容已保存，但刷新失败；不要重复应用。" : ""}${message(e)}`);
    } finally { locked.current = false; setBusy(false); }
  };
  const hasProposal = !!draft || cards.length > 0;
  const previewTitle = draft?.title ?? `复习卡预览 · ${cards.length} 张`;
  const previewMarkdown = draft?.body ?? cards.map((card, i) => [
    `## 第 ${i + 1} 题 · ${card.type === "choice" ? "选择题" : "简答题"}`,
    card.question,
    ...(card.options ?? []).map((option, index) => `**${String.fromCharCode(65 + index)}.** ${option}`),
    card.type === "choice" ? `**正确答案：${String.fromCharCode(65 + (card.correctIndex ?? 0))}**` : "### 参考答案",
    card.answer,
  ].join("\n\n")).join("\n\n---\n\n");
  return <><dialog ref={dialog} className="ai-authoring workspace-panel" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="workspace-actions"><h2>AI 写作</h2><button type="button" disabled={busy} onClick={onClose}>关闭</button></header>
    <p>先生成草稿，再确认保存。不会自动改写文章；关闭面板会放弃未保存草稿。</p>
    <fieldset disabled={busy || hasProposal}>
      <div className="mode-tabs" role="tablist" aria-label="AI 任务类型">
        <button type="button" role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "on" : ""} disabled={!target.rel} onClick={() => { setMode("edit"); clear(); }}>修改当前文章</button>
        <button type="button" role="tab" aria-selected={mode === "new"} className={mode === "new" ? "on" : ""} onClick={() => { setMode("new"); clear(); }}>写新文章</button>
        <button type="button" role="tab" aria-selected={mode === "cards"} className={mode === "cards" ? "on" : ""} disabled={!target.rel} onClick={() => { setMode("cards"); clear(); }}>制作复习卡</button>
      </div>
      {mode === "new" ? <label>保存板块<select value={section} onChange={(e) => setSection(e.target.value)}>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : <p>目标文章：{target.rel}</p>}
      {mode === "cards" && <div className="authoring-check card-type" role="radiogroup" aria-label="卡片题型">
        <label><input type="radio" name="card-type" checked={cardType === "choice"} onChange={() => { setCardType("choice"); clear(); }} />选择题（默认）</label>
        <label><input type="radio" name="card-type" checked={cardType === "short"} onChange={() => { setCardType("short"); clear(); }} />简答题</label>
      </div>}
      <AuthoringTemplates key={mode} mode={mode} instruction={instruction} onSelect={setInstruction} />
      <label>你的要求<textarea maxLength={6000} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={mode === "edit" ? "例如：保留原有内容和图片，补充例子，修正错误，并改善章节结构。" : mode === "new" ? "例如：写一篇 Rust 所有权入门教程，包含示例和练习。" : cardType === "choice" ? "例如：围绕本篇重点制作 5 道四选一选择题。" : "例如：围绕本篇重点制作 5 张简答复习卡。"} /></label>
    </fieldset>
    {provider
      ? <p className="authoring-disclosure"><span className="authoring-model-chip">模型：{provider.name} / {provider.model}</span>。点击下方按钮将发送你的要求{mode !== "new" ? "和当前文章完整标题、正文（不含其他元信息）" : "，不发送已有文章"}给该模型供应商。长文超过 60,000 字符会拒绝而非截断。</p>
      : <p className="authoring-disclosure"><span className="authoring-model-chip">未添加模型</span>。请先在「AI 模型设置」中从预设或自定义添加并选中一个模型。</p>}
    <div className="workspace-actions">
      {!hasProposal && !streaming && <button type="button" className="action-primary" disabled={busy || !instruction.trim() || (mode === "new" && !section)} onClick={() => void generate()}>确认发送并生成</button>}
      {streaming && <button type="button" onClick={stop}>停止生成</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <div className="authoring-progress" role="status" aria-live="polite"><span className="generation-orbit" aria-hidden="true">✦</span><div><strong>{streaming ? "正在生成你的内容…" : "正在处理…"}</strong><p>{streaming ? "完成后将自动打开阅读预览，当前不会写入文件。" : "正在准备内容或保存，请稍候。"}</p>{streaming && <small>已接收 {raw.length.toLocaleString()} 字符</small>}</div></div>}
    {hasProposal && <div className="authoring-ready" role="status">
      <strong>{mode === "cards" ? `已生成 ${cards.length} 张复习卡，其中已选 ${cards.filter((c) => c.selected).length} 张` : `草稿《${draft!.title}》已生成 · ${draft!.body.length} 字符`}</strong>
      <div className="workspace-actions">
        <button type="button" className="action-primary" disabled={busy} onClick={() => setPreviewOpen(true)}>打开阅读预览</button>
        <button type="button" disabled={busy} onClick={() => setDraftEditor((v) => !v)}>{draftEditor ? "收起草稿编辑" : "编辑草稿"}</button>
        <button type="button" disabled={busy} onClick={clear}>放弃 / 重新生成</button>
      </div>
      <p>预览确认后再应用；编辑草稿会要求重新勾选确认。</p>
    </div>}
    {draft && <div className="authoring-comparison" hidden={!draftEditor}>
      {mode === "edit" && baseline && <details><summary>查看修改前原文（{baseline.body.length} 字符）</summary><pre>{baseline.title}{"\n\n"}{baseline.body}</pre></details>}
      <label>草稿标题<input disabled={busy} maxLength={80} value={draft.title} onChange={(e) => { setAcknowledged(false); setDraft({ ...draft, title: e.target.value }); }} /></label>
      <label>草稿正文（Markdown，可继续编辑 · {draft.body.length} 字符）<textarea disabled={busy} className="authoring-body" value={draft.body} onChange={(e) => { setAcknowledged(false); setDraft({ ...draft, body: e.target.value }); }} /></label>
    </div>}
    {cards.map((card, i) => <fieldset key={i} disabled={busy} className="authoring-card" hidden={!draftEditor}>
      <label className="authoring-check"><input type="checkbox" checked={card.selected} onChange={(e) => { setAcknowledged(false); setCards(cards.map((c, j) => j === i ? { ...c, selected: e.target.checked } : c)); }} />加入第 {i + 1} 张</label>
      <label>问题<textarea value={card.question} maxLength={1000} onChange={(e) => { setAcknowledged(false); setCards(cards.map((c, j) => j === i ? { ...c, question: e.target.value } : c)); }} /></label>
      {card.type === "choice" && <div className="authoring-options">
        <p>选项与正确答案（点击圆点标记正确项）</p>
        {card.options?.map((option, index) => <label className="authoring-check" key={index}>
          <input type="radio" name={`correct-${i}`} aria-label={`第 ${i + 1} 题正确答案 ${String.fromCharCode(65 + index)}`} checked={card.correctIndex === index} onChange={() => { setAcknowledged(false); setCards(cards.map((c, j) => j === i ? { ...c, correctIndex: index } : c)); }} />
          <span>{String.fromCharCode(65 + index)}</span><input aria-label={`第 ${i + 1} 题选项 ${String.fromCharCode(65 + index)}`} maxLength={500} value={option} onChange={(e) => { setAcknowledged(false); setCards(cards.map((c, j) => j === i ? { ...c, options: c.options!.map((v, k) => k === index ? e.target.value : v) } : c)); }} />
        </label>)}
      </div>}
      <label>{card.type === "choice" ? "答案解析" : "答案"}<textarea value={card.answer} maxLength={6000} onChange={(e) => { setAcknowledged(false); setCards(cards.map((c, j) => j === i ? { ...c, answer: e.target.value } : c)); }} /></label>
    </fieldset>)}
    {hasProposal && draftEditor && <><label className="authoring-check authoring-ack"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />我已核对内容，确认{labels[mode]}</label><button type="button" className="action-primary" disabled={busy || (mode === "cards" && !cards.some((c) => c.selected))} onClick={() => { if (!acknowledged) { setError("请先勾选「我已核对内容」再确认应用。"); return; } void apply(); }}>{mode === "cards" ? "确认加入复习队列" : mode === "edit" ? "确认保存修改（保留历史）" : "确认创建新文章"}</button></>}
    {raw && !streaming && <details open={!!error}><summary>{streaming ? "生成中的输出" : "原始模型输出（可复制）"}</summary><pre className="authoring-raw">{raw}</pre></details>}
    {savedRel && <button type="button" disabled={busy} onClick={() => { onClose(); void useNav.getState().openArticle(savedRel, savedRel.split("/")[0]); }}>打开文章</button>}
  </dialog>
    {previewOpen && hasProposal && <AuthoringPreview title={previewTitle} markdown={previewMarkdown} onClose={() => setPreviewOpen(false)} onApply={() => { setPreviewOpen(false); setDraftEditor(true); setAcknowledged(true); void apply(); }} applyLabel={mode === "cards" ? "确认加入复习队列" : mode === "edit" ? "确认保存修改（保留历史）" : "确认创建新文章"} applyDisabled={busy || (mode === "cards" && !cards.some((c) => c.selected))} />}
  </>;
}
