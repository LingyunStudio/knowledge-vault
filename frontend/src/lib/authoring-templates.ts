export type TemplateMode = "edit" | "new" | "cards";
export interface AuthoringTemplate { id: string; name: string; mode: TemplateMode; text: string }
const KEY = "knowledge-vault-authoring-templates-v1";
export const builtInTemplates: AuthoringTemplate[] = [
  { id: "polish", mode: "edit", name: "保留原意润色", text: "请在保留原意、全部重要知识点、代码、图片和链接的前提下润色全文，改善表达与章节结构。不要删减细节，不确定的事实请明确标注。" },
  { id: "examples", mode: "edit", name: "补充示例", text: "保留原文内容，为重点和难点补充简洁、可理解的示例，说明使用场景与常见误区。保留现有代码、图片与链接。" },
  { id: "logic", mode: "edit", name: "检查逻辑", text: "检查文章的逻辑、概念一致性与前后矛盾，修正明显错误并补齐必要解释。保留原有重要内容，无法确定的结论明确标注，不编造依据。" },
  { id: "intro", mode: "new", name: "入门教程", text: "请围绕【填写主题】写一篇面向初学者的入门教程，依次包含学习目标、必要前置知识、核心概念、分步示例、常见错误和总结。" },
  { id: "reference", mode: "new", name: "知识速查表", text: "请围绕【填写主题】写一份实用的知识速查表，按使用场景组织，包含核心概念、常用写法、简短示例和易混淆点。" },
  { id: "project", mode: "new", name: "项目实践", text: "请围绕【填写主题】设计一个小型实践项目教程，说明目标、准备条件、实现步骤、关键代码、验证方法和可扩展方向。" },
  { id: "basics", mode: "cards", name: "基础概念", text: "围绕本篇文章最重要的基础概念制作 5 张复习卡，每张只考查一个知识点，答案附简明解释，遵循当前选择的题型。" },
  { id: "pitfalls", mode: "cards", name: "易错点", text: "围绕本篇容易混淆的概念与常见误区制作 5 张复习卡，答案解释为什么容易出错。若为选择题，干扰项要合理且只有一个正确答案。" },
  { id: "code", mode: "cards", name: "代码理解", text: "根据本篇已有代码示例制作 5 张代码理解复习卡，考查执行结果、设计理由或错误原因。不要引入文中没有依据的知识，遵循当前选择的题型。" },
];
export function validateTemplates(value: unknown): AuthoringTemplate[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error("最多保存 30 个模板。");
  const ids = new Set<string>();
  return value.map((v) => {
    if (!v || typeof v.id !== "string" || !v.id || v.id.length > 100 || ids.has(v.id)
      || !["edit", "new", "cards"].includes(v.mode) || typeof v.name !== "string" || !v.name.trim() || v.name.length > 40
      || typeof v.text !== "string" || !v.text.trim() || v.text.length > 6000) throw new Error("模板数据无效，原始存储未被覆盖。");
    ids.add(v.id);
    return { id: v.id, name: v.name.trim(), mode: v.mode, text: v.text };
  });
}
export function loadTemplates(): AuthoringTemplate[] {
  const raw = localStorage.getItem(KEY);
  return raw ? validateTemplates(JSON.parse(raw)) : [];
}
export function saveTemplates(templates: AuthoringTemplate[]): AuthoringTemplate[] {
  const next = validateTemplates(templates);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
