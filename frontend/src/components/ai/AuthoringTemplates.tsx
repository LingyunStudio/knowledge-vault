import { useState } from "react";
import { builtInTemplates, loadTemplates, saveTemplates, type AuthoringTemplate, type TemplateMode } from "../../lib/authoring-templates";

export function AuthoringTemplates({ mode, instruction, onSelect }: { mode: TemplateMode; instruction: string; onSelect: (text: string) => void }) {
  const [initial] = useState(() => { try { return { templates: loadTemplates(), error: "" }; } catch { return { templates: [], error: "模板读取失败，原始数据未被覆盖。" }; } });
  const [templates, setTemplates] = useState<AuthoringTemplate[]>(initial.templates);
  const [error, setError] = useState(initial.error);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<AuthoringTemplate | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const select = (template: AuthoringTemplate) => {
    if (instruction.trim() && instruction !== template.text) setPending(template);
    else { onSelect(template.text); setPending(null); }
  };
  const persist = (next: AuthoringTemplate[]) => {
    try { setTemplates(saveTemplates(next)); setError(""); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "模板保存失败，请检查存储空间。"); return false; }
  };
  return <div className="authoring-templates">
    <span className="authoring-template-label">快捷模板 · 填入后可继续修改</span>
    <div className="authoring-template-chips">{builtInTemplates.filter((t) => t.mode === mode).map((t) => <button type="button" key={t.id} onClick={() => select(t)}>{t.name}</button>)}</div>
    {pending && <div className="authoring-template-confirm" role="group" aria-label="替换要求确认"><span>用「{pending.name}」替换当前要求？</span><button type="button" onClick={() => { onSelect(pending.text); setPending(null); }}>确认替换</button><button type="button" onClick={() => setPending(null)}>取消替换</button></div>}
    <details><summary>我的模板{templates.filter((t) => t.mode === mode).length ? `（${templates.filter((t) => t.mode === mode).length}）` : ""}</summary>
      <p>仅保存在本机，不会自动发送给模型；暂不包含在知识库备份中。</p>
      <div className="authoring-template-chips">{templates.filter((t) => t.mode === mode).map((t) => <span className="authoring-custom-template" key={t.id}><button type="button" onClick={() => select(t)}>{t.name}</button><button type="button" aria-label={`删除模板 ${t.name}`} onClick={() => setDeleting(t.id)}>×</button></span>)}</div>
      {deleting && <div className="authoring-template-confirm"><span>删除这个自定义模板？</span><button type="button" onClick={() => { if (persist(templates.filter((t) => t.id !== deleting))) setDeleting(null); }}>确认删除模板</button><button type="button" onClick={() => setDeleting(null)}>取消删除</button></div>}
      <div className="authoring-template-save"><label>模板名称<input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我常用的教程要求" /></label><button type="button" disabled={!!initial.error || !name.trim() || !instruction.trim()} onClick={() => { if (persist([...templates, { id: crypto.randomUUID(), name, text: instruction, mode }])) setName(""); }}>保存当前要求为模板</button></div>
    </details>
    {error && <p role="alert">{error}</p>}
  </div>;
}
