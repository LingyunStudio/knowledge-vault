import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` } });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  source = source.replace(/^import .*\.css";$/gm, "");
  for (const [from, to] of Object.entries(replacements)) source = source.split(`"${from}"`).join(`"${to}"`);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  return url(outputText.split('"react/jsx-runtime"').join(JSON.stringify(import.meta.resolve("react/jsx-runtime"))));
}

const storeUrl = url("const store = (selector) => selector(globalThis.__state); store.getState = () => globalThis.__state; export const useLibrary = store;");
const ipcUrl = url(`export const ipc = new Proxy({}, { get: (_t, name) => (...args) => {
  globalThis.__backupTest.calls.push(["ipc", name, ...args]);
  const handler = globalThis.__backupTest.ipc[name];
  if (handler) return handler(...args);
  return Promise.resolve([]);
} });`);
const coordinatorUrl = url("export const flushPending = async () => { if (globalThis.__backupTest.flushError) throw new Error(globalThis.__backupTest.flushError); };");

const learningUrl = await moduleUrl("../src/store/learning.ts", { zustand: import.meta.resolve("zustand") });
const { useLearning } = await import(learningUrl);
const backupUrl = await moduleUrl("../src/lib/learning-backup.ts", { "../store/learning": learningUrl });
const { validateLearningBackup, exportLearningBackup, importLearningBackup } = await import(backupUrl);
const { BackupSettings } = await import(await moduleUrl("../src/components/shell/BackupSettings.tsx", {
  react: import.meta.resolve("react"), "../../lib/ipc": ipcUrl, "../../lib/learning-backup": backupUrl,
  "../../lib/save-coordinator": coordinatorUrl, "../../store/library": storeUrl, "../../store/learning": learningUrl,
}));

async function mount(Component) {
  const el = document.createElement("div"); document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(React.createElement(Component)));
  return { el, close: async () => { await act(async () => root.unmount()); el.remove(); } };
}
const click = async (b) => act(async () => b.click());
const button = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
const reset = () => {
  globalThis.__backupTest = { calls: [], ipc: {}, flushError: "" };
  globalThis.__state = { root: { path: "C:/vault", source: "test", writable: true }, data: { sections: [], articles: [] }, rescan: async () => {} };
  useLearning.setState({ vaults: {}, error: null });
  localStorage.clear();
};
reset();

const validPayload = () => ({
  articles: { "rust/one.md": { favorite: true, visited: 5, scroll: 42, status: "review" } },
  cards: [{ id: "c1", rel: "rust/one.md", question: "Q", answer: "A", due: 1_700_000_000_000, interval: 2 }],
  activity: { "2024-02-29": { read: ["rust/one.md"], created: 1, reviewed: 0 } },
});

const mutations = {
  "protocol path": (data) => { data.cards[0].rel = "https://evil/x.md"; },
  "absolute path": (data) => { data.cards[0].rel = "C:/outside.md"; },
  "parent traversal": (data) => { data.cards[0].rel = "../outside.md"; },
  "unknown top field": (data) => { data.extra = 1; },
  "unknown record field": (data) => { data.articles["rust/one.md"].tags = []; },
  "unknown card field": (data) => { data.cards[0].weight = 1; },
  "unknown day field": (data) => { data.activity["2024-02-29"].score = 1; },
  "bad article status": (data) => { data.articles["rust/one.md"].status = "done"; },
  "bad path type": (data) => { data.cards[0].rel = 5; },
  "duplicate card ids": (data) => { data.cards.push({ ...data.cards[0] }); },
  "choice with 3 options": (data) => { data.cards[0] = { ...data.cards[0], type: "choice", options: ["A", "B", "C"], correctIndex: 0 }; },
  "choice with 5 options": (data) => { data.cards[0] = { ...data.cards[0], type: "choice", options: ["A", "B", "C", "D", "E"], correctIndex: 0 }; },
  "choice duplicate options": (data) => { data.cards[0] = { ...data.cards[0], type: "choice", options: ["A", "A", "C", "D"], correctIndex: 0 }; },
  "choice index out of range": (data) => { data.cards[0] = { ...data.cards[0], type: "choice", options: ["A", "B", "C", "D"], correctIndex: 4 }; },
  "choice index non integer": (data) => { data.cards[0] = { ...data.cards[0], type: "choice", options: ["A", "B", "C", "D"], correctIndex: 1.5 }; },
  "short card with choice fields": (data) => { data.cards[0] = { ...data.cards[0], options: ["A", "B", "C", "D"], correctIndex: 1 }; },
  "unknown card type": (data) => { data.cards[0] = { ...data.cards[0], type: "cloze" }; },
  "empty card id": (data) => { data.cards[0].id = "  "; },
  "bad date key": (data) => { data.activity["2026-13-40"] = { read: [], created: 0, reviewed: 0 }; },
  "plausible but invalid date": (data) => { delete data.activity["2024-02-29"]; data.activity["2026-02-30"] = { read: [], created: 0, reviewed: 0 }; },
  "date with time": (data) => { delete data.activity["2024-02-29"]; data.activity["2024-02-29T10:00"] = { read: [], created: 0, reviewed: 0 }; },
  "negative count": (data) => { data.activity["2024-02-29"].created = -1; },
  "float count": (data) => { data.activity["2024-02-29"].reviewed = 1.5; },
  "infinite due": (data) => { data.cards[0].due = Number.POSITIVE_INFINITY; },
  "NaN scroll": (data) => { data.articles["rust/one.md"].scroll = NaN; },
  "non leap date": (data) => { data.activity["2026-02-29"] = { read: [], created: 0, reviewed: 0 }; },
  "backslash traversal": (data) => { data.cards[0].rel = "a\\..\\b.md"; },
  "UNC path": (data) => { data.cards[0].rel = "\\\\server\\a.md"; },
  "too many cards": (data) => { data.cards = Array(100_001).fill(data.cards[0]); },
  "too many daily reads": (data) => { data.activity["2024-02-29"].read = Array(100_001).fill("a.md"); },
  "array with extra key": (data) => { data.cards.extra = 1; },
  "null payload": () => null,
  "array payload": () => [],
  "missing cards": ({ cards, ...rest }) => rest,
  "empty article path": (data) => { delete data.articles["rust/one.md"]; data.articles[""] = { favorite: false, visited: 0, scroll: 0, status: "unread" }; },
  "nested traversal": (data) => { delete data.articles["rust/one.md"]; data.articles["a/../../b.md"] = { favorite: false, visited: 0, scroll: 0, status: "unread" }; },
  "oversized question": (data) => { data.cards[0].question = "x".repeat(10_001); },
};

for (const [name, mutate] of Object.entries(mutations)) {
  test(`validator rejects: ${name}`, () => {
    const data = validPayload();
    const result = mutate(data);
    assert.throws(() => validateLearningBackup(result === undefined ? data : result), /学习备份数据无效|未导入/, name);
  });
}

test("validator keeps valid payload and legacy short cards, enforces 10 MiB cap, and roundtrips", () => {
  const value = validateLearningBackup(validPayload());
  assert.deepEqual(value, validPayload(), "valid data unchanged");
  assert.deepEqual(value.cards[0], validPayload().cards[0], "legacy short card without type kept");
  assert.deepEqual(validateLearningBackup({ articles: {}, cards: [] }), { articles: {}, cards: [] }, "empty vault ok");
  const huge = { articles: {}, cards: Array.from({ length: 110 }, (_, i) => ({
    ...validPayload().cards[0], id: `large-${i}`, answer: "x".repeat(100_000),
  })) };
  assert.throws(() => validateLearningBackup(huge), /10 MiB/);
  useLearning.setState({ vaults: {}, error: null }); localStorage.clear();
});

test("choice cards roundtrip without dropping fields", () => {
  const data = validPayload();
  Object.assign(data.cards[0], { type: "choice", options: ["A", "B", "C", "D"], correctIndex: 2 });
  assert.deepEqual(validateLearningBackup(data), data);
});

test("import preserves persisted-only vaults and refuses case-equivalent on-disk root", () => {
  reset();
  const old = validPayload();
  const disk = { "D:/Other": old };
  localStorage.setItem("knowledge-vault-learning-v1", JSON.stringify(disk));
  assert.throws(() => importLearningBackup("d:\\other\\", validPayload()), /拒绝覆盖/);
  const before = localStorage.getItem("knowledge-vault-learning-v1");
  assert.equal(before, JSON.stringify(disk));
  importLearningBackup("C:/fresh", validPayload());
  assert.deepEqual(JSON.parse(localStorage.getItem("knowledge-vault-learning-v1"))["D:/Other"], old);
  assert.deepEqual(useLearning.getState().vaults["D:/Other"], old);
  reset();
});

test("exportLearningBackup validates and reuses store data, refusing store errors", () => {
  reset();
  useLearning.setState({ vaults: { "c:/vault": validPayload() } });
  assert.deepEqual(exportLearningBackup("C:\\vault\\"), validPayload(), "root normalized via store rootKey");
  useLearning.setState({ error: "存储已损坏" });
  assert.throws(() => exportLearningBackup("C:/vault"), /存储已损坏/);
  useLearning.setState({ error: null, vaults: {} });
  assert.throws(() => exportLearningBackup("  "), /尚未就绪/);
});

test("import is atomic: no overwrite of existing root, quota failure leaves state untouched", () => {
  reset();
  const proto = window.Storage.prototype;
  const original = proto.setItem;
  try {
    useLearning.setState({ vaults: { "c:/existing": validPayload() } });
    assert.throws(() => importLearningBackup("C:/EXISTING/", validPayload()), /拒绝覆盖/);
    assert.throws(() => importLearningBackup("C:/existing/", validPayload()), /拒绝覆盖/);
    assert.deepEqual(useLearning.getState().vaults["c:/existing"], validPayload(), "existing root untouched");

    proto.setItem = () => { throw new Error("quota full"); };
    assert.throws(() => importLearningBackup("C:/restored", validPayload()), /quota full/);
    assert.deepEqual(useLearning.getState().vaults, { "c:/existing": validPayload() }, "quota failure changes nothing");
    assert.equal(localStorage.getItem("knowledge-vault-learning-v1"), null, "no partial write");

    proto.setItem = function (...args) { writes++; return original.apply(this, args); };
    let writes = 0;
    importLearningBackup("C:/restored", validPayload());
    assert.equal(writes, 1, "exactly one atomic persistence");
    assert.deepEqual(useLearning.getState().vaults["c:/restored"], validPayload());
    assert.deepEqual(useLearning.getState().vaults["c:/existing"], validPayload(), "other vault preserved");
    assert.deepEqual(JSON.parse(localStorage.getItem("knowledge-vault-learning-v1"))["c:/restored"], validPayload());
  } finally { proto.setItem = original; reset(); }
});

test("import refuses corrupt existing storage and propagates store errors without overwriting", () => {
  reset();
  useLearning.setState({ error: "学习记录读取失败" });
  assert.throws(() => importLearningBackup("C:/restored", validPayload()), /学习记录读取失败/);
  assert.deepEqual(useLearning.getState().vaults, {}, "refused import does not write");
  useLearning.setState({ error: null, vaults: {} });
  localStorage.setItem("knowledge-vault-learning-v1", "{not json");
  assert.throws(() => importLearningBackup("C:/restored", validPayload()), /现有学习存储损坏/);
  assert.equal(useLearning.getState().vaults["c:/restored"], undefined, "corrupt storage refuses import");
  localStorage.setItem("knowledge-vault-learning-v1", JSON.stringify({ "c:/old": { articles: {}, cards: [], activity: { bad: {} } } }));
  assert.throws(() => importLearningBackup("C:/restored", validPayload()), /损坏|无效/);
  assert.equal(JSON.parse(localStorage.getItem("knowledge-vault-learning-v1")).bad, undefined, "corrupt on-disk data untouched");
  reset();
});

test("UI: locked create button, coverage text, list with path, restore confirm and truthful storage error", async () => {
  reset();
  const created = [];
  useLearning.setState({ vaults: { "c:/vault": validPayload() } });
  globalThis.__backupTest.ipc = {
    libraryRoot: async () => globalThis.__state.root,
    listBackups: async () => [{ id: "b1", createdMs: Date.UTC(2026, 4, 1), sourceRoot: "C:/vault", files: 12, bytes: 2048, path: "D:/data/backups/b1" }],
    createBackup: async (root, learning) => { created.push([root, learning]); return { id: "b2", createdMs: Date.UTC(2026, 4, 2), sourceRoot: root, files: 12, bytes: 2048, path: "D:/data/backups/b2" }; },
    restoreBackup: async () => ({ path: "D:/data/restored/r1/knowledge", learning: validPayload() }),
  };
  const ui = await mount(BackupSettings);
  try {
    assert.match(ui.el.textContent, /手动备份/);
    assert.match(ui.el.textContent, /不包含/);
    assert.match(ui.el.textContent, /同一磁盘/);
    assert.match(ui.el.textContent, /不会删除旧备份|没有自动备份/);
    const createBtn = button(ui.el, "立即创建手动备份");
    assert.ok(createBtn, "manual create button");
    await click(createBtn);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0][0], "C:/vault", "captures expected root");
    assert.deepEqual(created[0][1], validPayload(), "learning payload captured");
    assert.match(ui.el.textContent, /手动备份已创建/);
    assert.match(ui.el.textContent, /D:\/data\/backups\/b1/, "backup path shown for copy");
    assert.ok(button(ui.el, "复制备份路径"), "backup path copy button");
    assert.match(ui.el.textContent, /12 个文件/);
    assert.match(ui.el.textContent, /2\.0 KiB/);

    assert.ok(ui.el.querySelector('.backup-list button[aria-disabled="false"], .backup-list button:not([disabled])'), "list restore enabled");
    await click(button(ui.el, "恢复为独立副本"));
    assert.match(ui.el.querySelector(".backup-confirm").textContent, /不覆盖|全新/);
    assert.match(ui.el.querySelector(".backup-confirm").textContent, /不自动切换|不切换/);
    await click(button(ui.el, "确认创建恢复副本"));
    assert.match(ui.el.textContent, /D:\/data\/restored\/r1\/knowledge/, "restored path shown");
    assert.ok(button(ui.el, "复制恢复路径"));
    assert.match(ui.el.textContent, /学习记录已保存/);
    assert.ok(!ui.el.querySelector(".backup-error"), "no error on clean restore");
    assert.doesNotMatch(ui.el.textContent, /无法恢复|失败/);
    assert.match(ui.el.textContent, /环境变量 KNOWLEDGE_VAULT_ROOT/, "mentions opt-in only");
    assert.equal(globalThis.__state.root.path, "C:/vault", "restore never switches the active root");
  } finally { await ui.close(); reset(); }
});

test("UI: failed flush and changed root refuse backup; pending create is locked", async () => {
  reset();
  globalThis.__backupTest.ipc.libraryRoot = async () => globalThis.__state.root;
  globalThis.__backupTest.flushError = "save conflict";
  const ui = await mount(BackupSettings);
  try {
    await click(button(ui.el, "立即创建手动备份"));
    assert.match(ui.el.textContent, /save conflict/);
    assert.ok(!globalThis.__backupTest.calls.some((c) => c[1] === "createBackup"));
    globalThis.__backupTest.flushError = "";
    globalThis.__backupTest.ipc.libraryRoot = async () => ({ path: "D:/changed" });
    await click(button(ui.el, "立即创建手动备份"));
    assert.match(ui.el.textContent, /知识库已改变/);
    assert.ok(!globalThis.__backupTest.calls.some((c) => c[1] === "createBackup"));
    globalThis.__backupTest.ipc.libraryRoot = async () => globalThis.__state.root;
    let finish;
    globalThis.__backupTest.ipc.createBackup = () => new Promise((resolve) => { finish = resolve; });
    const create = button(ui.el, "立即创建手动备份");
    await act(async () => { create.click(); create.click(); });
    assert.equal(globalThis.__backupTest.calls.filter((c) => c[1] === "createBackup").length, 1);
    assert.ok(button(ui.el, "正在保存并创建备份…").disabled);
    await act(async () => finish({ createdMs: 1 }));
  } finally { await ui.close(); reset(); }
});

test("UI: restore still reports recovered path when learning import fails", async () => {
  reset();
  globalThis.__backupTest.ipc = {
    listBackups: async () => [{ id: "b1", createdMs: 1, sourceRoot: "C:/vault", files: 1, bytes: 10, path: "D:/backups/b1" }],
    restoreBackup: async () => ({ path: "D:/data/restored/r2/knowledge", learning: validPayload() }),
  };
  const proto = window.Storage.prototype;
  const original = proto.setItem;
  proto.setItem = () => { throw new Error("quota exceeded"); };
  const ui = await mount(BackupSettings);
  try {
    await click(button(ui.el, "恢复为独立副本"));
    await click(button(ui.el, "确认创建恢复副本"));
    assert.match(ui.el.querySelector('.backup-result').textContent, /D:\/data\/restored\/r2\/knowledge/);
    assert.match(ui.el.querySelector('[role="alert"]').textContent, /quota exceeded/);
    assert.match(ui.el.querySelector('[role="alert"]').textContent, /学习数据仍保留在后端恢复副本/);
    assert.doesNotMatch(ui.el.textContent, /学习记录已保存/);
  } finally { proto.setItem = original; await ui.close(); reset(); }
});

test("UI: learning store error disables create; restore backend failure keeps data intact", async () => {
  reset();
  let restoreAttempts = 0;
  globalThis.__backupTest.ipc.listBackups = async () => [{ id: "b1", createdMs: 1, sourceRoot: "C:/vault", files: 1, bytes: 10, path: "D:/backups/b1" }];
  globalThis.__backupTest.ipc.restoreBackup = async () => { restoreAttempts++; throw new Error("disk full"); };
  useLearning.setState({ vaults: {}, error: "学习记录未能持久保存：存储空间不足或不可用。" });
  const ui = await mount(BackupSettings);
  try {
    assert.ok(button(ui.el, "立即创建手动备份").disabled, "create locked while learning store has error");
    assert.match(ui.el.querySelector('[role="alert"]').textContent, /学习记录未能持久保存/);
    await click(button(ui.el, "恢复为独立副本"));
    await click(button(ui.el, "确认创建恢复副本"));
    assert.match(ui.el.textContent, /disk full/);
    assert.equal(restoreAttempts, 1);
    assert.deepEqual(useLearning.getState().vaults, {}, "backend failure imports nothing");
  } finally { await ui.close(); reset(); }
});
