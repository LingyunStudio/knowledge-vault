import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

// 系统凭据库桩：进程内 Map + 调用记录；hold 可暂停 set 以观察迁移中途状态
globalThis.__kvCredStub = { store: new Map(), calls: [], hold: null };
const ipcStubSource = `
export const ipc = {
  async credentialSet(id, apiKey) {
    const s = globalThis.__kvCredStub;
    s.calls.push(["set", id, apiKey]);
    if (s.hold) await s.hold;
    if (apiKey === "") s.store.delete(id);
    else s.store.set(id, apiKey);
  },
  async credentialGet(id) {
    return globalThis.__kvCredStub.store.get(id) ?? null;
  },
  async credentialDelete(id) {
    const s = globalThis.__kvCredStub;
    s.calls.push(["delete", id]);
    s.store.delete(id);
  },
};
`;
const ipcStubUrl = `data:text/javascript;base64,${Buffer.from(ipcStubSource).toString("base64")}`;

async function moduleUrl(path, replacements = {}, nonce = "") {
  let source = await readFile(new URL(path.split("#")[0], import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.split(`"${from}"`).join(`"${to}"`);
  if (nonce) source += `\n//${nonce}`;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const presetsUrl = await moduleUrl("../src/lib/ai-presets.ts");

/** 每次加载一个全新 store 实例（nonce 追加注释使模块地址不同），模拟应用重启 */
async function loadStore(nonce) {
  const url = await moduleUrl("../src/store/ai.ts", {
    "../lib/ai-presets": presetsUrl,
    "../lib/ipc": ipcStubUrl,
    zustand: import.meta.resolve("zustand"),
    "zustand/middleware": import.meta.resolve("zustand/middleware"),
  }, nonce);
  return import(url);
}
const drain = () => new Promise((r) => setTimeout(r, 20));
const seedStorage = (providers, activeId = providers[0]?.id ?? "") =>
  localStorage.setItem("knowledge-vault-ai", JSON.stringify({ state: { providers, activeId }, version: 1 }));
const storedProviders = () => JSON.parse(localStorage.getItem("knowledge-vault-ai")).state.providers;

test("legacy plaintext keys migrate into the credential store and are stripped from localStorage", async () => {
  localStorage.clear();
  const stub = globalThis.__kvCredStub;
  stub.store.clear(); stub.calls.length = 0;
  let releaseHold;
  stub.hold = new Promise((r) => { releaseHold = r; });
  seedStorage([{ id: "ai-x", name: "X", baseUrl: "https://x", format: "openai", apiKey: "sk-legacy", model: "m" }]);

  const { useAi } = await loadStore("migrate");

  // 凭据写入已发起但被 hold：明文仍在 localStorage（迁移确认前不剥离，防丢 Key）
  assert.deepEqual(stub.calls[0], ["set", "ai-x", "sk-legacy"]);
  assert.equal(stub.store.has("ai-x"), false);
  useAi.setState({ settingsOpen: true }); // 迁移中途的任意写盘不得丢失明文
  assert.equal(storedProviders().find((p) => p.id === "ai-x").apiKey, "sk-legacy");

  releaseHold();
  await drain();
  assert.equal(stub.store.get("ai-x"), "sk-legacy"); // 已写入系统凭据库
  assert.equal(storedProviders().find((p) => p.id === "ai-x").apiKey, ""); // localStorage 明文已剥离
  assert.equal(useAi.getState().providers.find((p) => p.id === "ai-x").apiKey, "sk-legacy"); // 内存保留，本会话可用
  stub.hold = null;
});

test("keys hydrate from the credential store on startup without touching localStorage", async () => {
  localStorage.clear();
  const stub = globalThis.__kvCredStub;
  stub.store.clear(); stub.calls.length = 0;
  stub.store.set("ai-hy", "sk-hydrated");
  seedStorage([{ id: "ai-hy", name: "H", baseUrl: "https://h", format: "openai", apiKey: "", model: "m" }]);

  const { useAi } = await loadStore("hydrate");
  await drain();

  assert.equal(useAi.getState().providers.find((p) => p.id === "ai-hy").apiKey, "sk-hydrated");
  assert.equal(storedProviders().find((p) => p.id === "ai-hy").apiKey, "");
  assert.ok(!stub.calls.some(([op]) => op === "set")); // 水合只读不写
});

test("setApiKey writes the credential store and never persists the key to localStorage", async () => {
  localStorage.clear();
  const stub = globalThis.__kvCredStub;
  stub.store.clear(); stub.calls.length = 0;

  const { useAi } = await loadStore("set");
  await drain();
  const id = useAi.getState().addProvider({ name: "N", baseUrl: "https://n", format: "openai", model: "m", apiKey: "" });
  useAi.getState().setApiKey(id, "sk-new");
  await drain();

  assert.equal(stub.store.get(id), "sk-new");
  assert.equal(useAi.getState().providers.find((p) => p.id === id).apiKey, "sk-new");
  assert.equal(storedProviders().find((p) => p.id === id).apiKey, "");
  assert.ok(useAi.getState().keyRev > 0); // 广播计数已递增，另一窗口可感知
});

test("clearing the key deletes the credential; removing the provider cleans up too", async () => {
  localStorage.clear();
  const stub = globalThis.__kvCredStub;
  stub.store.clear(); stub.calls.length = 0;

  const { useAi } = await loadStore("cleanup");
  await drain();
  const id = useAi.getState().addProvider({ name: "N", baseUrl: "https://n", format: "openai", model: "m", apiKey: "" });
  useAi.getState().setApiKey(id, "sk-gone");
  await drain();
  assert.equal(stub.store.get(id), "sk-gone");

  useAi.getState().setApiKey(id, ""); // 清空 = 删除凭据
  await drain();
  assert.equal(stub.store.has(id), false);

  useAi.getState().setApiKey(id, "sk-again");
  await drain();
  useAi.getState().removeProvider(id); // 删除供应商同时清理凭据
  await drain();
  assert.equal(stub.store.has(id), false);
  assert.ok(stub.calls.some(([op, cid]) => op === "delete" && cid === id));
});
