import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const url = (s) => `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
async function moduleUrl(path, replacements = {}) {
  let source = (await readFile(new URL(path, import.meta.url), "utf8")).replace(/^import .*\.css";$/gm, "");
  for (const [a, b] of Object.entries(replacements)) source = source.replaceAll(`"${a}"`, JSON.stringify(b));
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return url(js.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime"))));
}
const fm = await moduleUrl("../src/lib/frontmatter.ts");
const helper = await moduleUrl("../src/lib/ai-authoring.ts", { "./frontmatter": fm });
const learning = await moduleUrl("../src/store/learning.ts", { zustand: import.meta.resolve("zustand") });
const { useLearning } = await import(learning);
const baseline = { rel: "s/a.md", title: "Original", body: "Original full body", fmRaw: 'title: "Original"\ncustom: keep', mtimeMs: 1, revision: "r1", tags: [] };
let state;
const boundary = url(`export const ipc = { libraryRoot: async () => globalThis.__author.root, readArticle: async () => ({...globalThis.__author.file}), writeArticle: async (...args) => { globalThis.__author.writes.push(args); } };
export const useLibrary = Object.assign((select) => select(globalThis.__author.library), {getState: () => globalThis.__author.library});
export const useNav = {getState: () => ({view:globalThis.__author.view, openArticle:async () => true})};
export const useAi = (select) => select({}); export const activeProvider = () => ({name:'Test',model:'text-model',baseUrl:'https://example.invalid',apiKey:'test',format:'openai'});
export const isImageModel = () => false;
export const sameRoot = (a,b) => a === b;
export const flushPending = async () => { if (globalThis.__author.flushError) throw new Error('save blocked'); };
export const streamChat = (opts) => { globalThis.__author.stream = opts; return {abort: () => {globalThis.__author.aborted = true;}}; };`);
globalThis.MutationObserver = window.MutationObserver;
const previewUrl = await moduleUrl("../src/components/ai/AuthoringPreview.tsx", {
  react: import.meta.resolve("react"), "../../editor/crepe": url(`export const createCrepe = async (opts) => { globalThis.__author.preview = opts; return { crepe: {destroy:async () => {}}, dispose:() => {}}; };`),
});
const templatesHelperUrl = await moduleUrl("../src/lib/authoring-templates.ts");
const templatesUrl = await moduleUrl("../src/components/ai/AuthoringTemplates.tsx", {
  react: import.meta.resolve("react"), "../../lib/authoring-templates": templatesHelperUrl,
});
const component = await moduleUrl("../src/components/ai/AiAuthoring.tsx", {
  "./AuthoringTemplates": templatesUrl,
  "./AuthoringPreview": previewUrl,
  react: import.meta.resolve("react"), "../../store/ai": boundary, "../../lib/ai-presets": boundary,
  "../../lib/ai-client": boundary, "../../lib/ipc": boundary, "../../lib/frontmatter": fm,
  "../../lib/save-coordinator": boundary, "../../lib/ai-learning": boundary, "../../lib/ai-authoring": helper,
  "../../store/library": boundary, "../../store/nav": boundary, "../../store/learning": learning,
});
const { AiAuthoring } = await import(component);
async function mount(mode = "edit") {
  state = globalThis.__author = { root: { path: "C:/k", writable: true }, file: { ...baseline }, writes: [], view: mode === "new" ? { name: "home" } : { name: "article", rel: baseline.rel } };
  state.library = { root: state.root, data: { sections: [{ id: "s", name: "Section" }] }, rescan: async () => {} };
  localStorage.clear(); useLearning.setState({ vaults: {}, error: null });
  const el = document.createElement("div"); document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(React.createElement(AiAuthoring, { onClose: () => {} })));
  if (mode === "cards") await click(button(el, "制作复习卡"));
  await input(el.querySelector("textarea"), "Create a useful draft");
  return { el, close: async () => { await act(async () => root.unmount()); el.remove(); } };
}
async function input(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  await act(async () => { el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const click = async (el) => { assert.ok(el, "button exists"); await act(async () => el.click()); };
const button = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const panelBtn = (el, text) => [...el.querySelectorAll(".ai-authoring button")].find((b) => b.textContent === text);
async function generate(ui, response) {
  await click(button(ui.el, "确认发送并生成"));
  assert.ok(state.stream, "request uses entered requirements");
  await act(async () => { state.stream.onDelta(JSON.stringify(response)); state.stream.onDone(); });
  assert.equal(state.writes.length, 0, "generation never writes");
  await click(ui.el.querySelector(".authoring-preview [aria-label='关闭预览']"));
  assert.equal(ui.el.querySelector(".authoring-preview"), null, "preview closed before panel actions");
}
async function approve(ui) { await click(ui.el.querySelector(".authoring-ack input")); }

test("batch cards persist atomically, deduplicate and can retry storage failure", () => {
  localStorage.clear(); useLearning.setState({ vaults: {}, error: null });
  const proto = window.Storage.prototype;
  const original = proto.setItem;
  const batch = [{ question: " Q ", answer: " A " }, { question: "Q", answer: "A" }];
  try {
    proto.setItem = () => { throw new Error("quota full"); };
    assert.throws(() => useLearning.getState().addCards("C:/k", "s/a.md", batch), /quota full/);
    assert.deepEqual(useLearning.getState().vaults, {});
    let writes = 0;
    proto.setItem = function (...args) { writes++; return original.apply(this, args); };
    assert.equal(useLearning.getState().addCards("C:/k", "s/a.md", batch), 1);
    assert.equal(writes, 1);
    assert.equal(useLearning.getState().addCards("C:/k", "s/a.md", batch), 0);
    assert.equal(writes, 1);
    assert.throws(() => useLearning.getState().addCards("C:/k", "s/a.md", Array(13).fill(batch[0])), /12/);
    useLearning.setState({ error: "corrupt storage" });
    assert.throws(() => useLearning.getState().addCards("C:/k", "s/a.md", batch), /corrupt storage/);
    assert.equal(writes, 1);
  } finally { proto.setItem = original; useLearning.setState({ vaults: {}, error: null }); }
});

test("templates fill requirements only after explicit replacement and never generate", async () => {
  const ui = await mount();
  try {
    await click(button(ui.el, "保留原意润色"));
    assert.equal(ui.el.querySelector("textarea").value, "Create a useful draft");
    assert.equal(state.stream, undefined);
    await click(button(ui.el, "取消替换"));
    assert.equal(ui.el.querySelector("textarea").value, "Create a useful draft");
    await click(button(ui.el, "保留原意润色"));
    await click(button(ui.el, "确认替换"));
    assert.match(ui.el.querySelector("textarea").value, /保留原意/);
    assert.equal(state.stream, undefined);
    assert.equal(state.writes.length, 0);
  } finally { await ui.close(); }
});

test("custom templates save current requirements and delete only after confirmation", async () => {
  const ui = await mount();
  try {
    await input(ui.el.querySelector('.authoring-template-save input'), '常用要求');
    await click(button(ui.el, '保存当前要求为模板'));
    const key = 'knowledge-vault-authoring-templates-v1';
    assert.equal(JSON.parse(localStorage.getItem(key))[0].text, 'Create a useful draft');
    assert.ok(button(ui.el, '常用要求'));
    await click(ui.el.querySelector('[aria-label="删除模板 常用要求"]'));
    assert.equal(JSON.parse(localStorage.getItem(key)).length, 1);
    await click(button(ui.el, '取消删除'));
    assert.equal(JSON.parse(localStorage.getItem(key)).length, 1);
    await click(ui.el.querySelector('[aria-label="删除模板 常用要求"]'));
    await click(button(ui.el, '确认删除模板'));
    assert.deepEqual(JSON.parse(localStorage.getItem(key)), []);
    assert.equal(state.stream, undefined);
  } finally { await ui.close(); }
});

test("article proposal requires confirmation, preserves frontmatter and revision", async () => {
  const ui = await mount();
  try {
    await generate(ui, { title: "New", body: "Complete new body" });
    assert.match(ui.el.querySelector(".authoring-ready").textContent, /已生成/);
    await click(panelBtn(ui.el, "打开阅读预览"));
    assert.ok(ui.el.querySelector(".authoring-preview[open]"), "preview shows the draft");
    await click(ui.el.querySelector(".authoring-preview .action-primary"));
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0][0], "s/a.md");
    assert.match(state.writes[0][1], /custom: keep/);
    assert.match(state.writes[0][1], /Complete new body/);
    assert.equal(state.writes[0][3], "r1");
    assert.equal(ui.el.querySelector(".authoring-preview"), null);
    assert.equal(panelBtn(ui.el, "确认保存修改（保留历史）"), undefined);
    assert.equal(panelBtn(ui.el, "编辑草稿"), undefined, "saved draft is cleared");
  } finally { await ui.close(); }
});

test("stale article and failed flush refuse application without writes", async () => {
  const ui = await mount();
  try {
    await generate(ui, { title: "New", body: "Body" });
    state.file.revision = "external";
    await click(panelBtn(ui.el, "打开阅读预览"));
    await click(ui.el.querySelector(".authoring-preview .action-primary"));
    assert.equal(state.writes.length, 0);
    assert.match(ui.el.querySelector('[role="alert"]').textContent, /改变/);
    state.file.revision = "r1"; state.flushError = true;
    await click(panelBtn(ui.el, "打开阅读预览"));
    await click(ui.el.querySelector(".authoring-preview .action-primary"));
    assert.equal(state.writes.length, 0);
    assert.match(ui.el.querySelector('[role="alert"]').textContent, /save blocked/);
  } finally { await ui.close(); }
});

test("stopped and failed generation cannot become an applicable proposal", async () => {
  for (const stop of [true, false]) {
    const ui = await mount();
    try {
      await click(button(ui.el, "确认发送并生成"));
      const stream = state.stream;
      await act(async () => stream.onDelta('{"title":"New",'));
      if (stop) await click(button(ui.el, "停止生成"));
      else await act(async () => stream.onError("provider failed"));
      await act(async () => { stream.onDelta('"body":"Body"}'); stream.onDone(); });
      assert.equal(button(ui.el, "确认保存修改（保留历史）"), undefined);
      assert.equal(state.writes.length, 0);
    } finally { await ui.close(); }
  }
});

test("new article uses atomic missing revision and no old article context", async () => {
  const ui = await mount("new");
  try {
    await generate(ui, { title: "New tutorial", body: "Whole tutorial" });
    assert.doesNotMatch(state.stream.messages[1].content, /Original full body/);
    assert.equal(ui.el.querySelector(".authoring-comparison").hidden, true);
    assert.equal(panelBtn(ui.el, "确认创建新文章"), undefined);
    await click(panelBtn(ui.el, "打开阅读预览"));
    await click(ui.el.querySelector(".authoring-preview .action-primary"));
    assert.equal(state.writes.length, 1);
    assert.match(state.writes[0][0], /^s\/New tutorial-.+\.md$/);
    assert.equal(state.writes[0][3], "missing");
  } finally { await ui.close(); }
});

test("cards require selection and confirmation, then persist once without article writes", async () => {
  const ui = await mount("cards");
  try {
    await generate(ui, { cards: [{ type: "choice", question: "Why?", options: ["A1", "B2", "C3", "D4"], correctIndex: 1, answer: "Because" },
      { type: "choice", question: "How?", options: ["W1", "W2", "W3", "W4"], correctIndex: 0, answer: "This way" }] });
    assert.deepEqual(useLearning.getState().vaults, {});
    assert.ok([...ui.el.querySelectorAll(".authoring-card")].every((card) => card.hidden));
    await click(panelBtn(ui.el, "编辑草稿"));
    await click(ui.el.querySelector(".authoring-card > .authoring-check input"));
    assert.equal(ui.el.querySelector(".authoring-ack input").checked, false);
    await approve(ui);
    await click(panelBtn(ui.el, "确认加入复习队列"));
    const saved = useLearning.getState().vaults["c:/k"].cards;
    assert.equal(saved.length, 1); assert.equal(saved[0].question, "How?");
    assert.equal(state.writes.length, 0);
    assert.equal(JSON.parse(localStorage.getItem("knowledge-vault-learning-v1"))["c:/k"].cards.length, 1);
  } finally { await ui.close(); }
});

test("choice cards preserve options and correct answer when applied from preview", async () => {
  const ui = await mount("cards");
  try {
    await generate(ui, { cards: [{ type: "choice", question: "Why?", options: ["A1", "B2", "C3", "D4"], correctIndex: 2, answer: "Because C" }] });
    await click(panelBtn(ui.el, "打开阅读预览"));
    await click(ui.el.querySelector(".authoring-preview .action-primary"));
    const saved = useLearning.getState().vaults["c:/k"].cards[0];
    assert.equal(saved.type, "choice");
    assert.deepEqual(saved.options, ["A1", "B2", "C3", "D4"]);
    assert.equal(saved.correctIndex, 2);
    assert.equal(button(ui.el, "确认加入复习队列"), undefined);
  } finally { await ui.close(); }
});
