import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function load(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  for (const [a, b] of Object.entries(replacements)) source = source.replaceAll(a, b);
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
}
const coordinatorUrl = await load("../src/lib/save-coordinator.ts");
const C = await import(coordinatorUrl);
const { createSaveQueue } = await import(await load("../src/lib/save-queue.ts"));
globalThis.document = { getElementById: () => ({ scrollTop: 123 }) };
const { useNav } = await import(await load("../src/store/nav.ts", {
  '"zustand"': JSON.stringify(import.meta.resolve("zustand")),
  '"../lib/save-coordinator"': JSON.stringify(coordinatorUrl),
  "import.meta.env.DEV": "false",
}));

test("failed save blocks article, section, search, home, and learning navigation", async () => {
  C.setPendingDirty(true);
  C.registerFlusher(async () => { throw new Error("disk full"); });
  for (const action of [() => useNav.getState().openArticle("s/a.md"), () => useNav.getState().openSection("s"), () => useNav.getState().setQuery("rust"), () => useNav.getState().goHome(), () => useNav.getState().openLearning()]) {
    assert.equal(await action(), false);
    assert.deepEqual(useNav.getState().view, { name: "home" });
    assert.equal(useNav.getState().query, "");
    assert.match(useNav.getState().error, /disk full/);
  }
  C.registerFlusher(async () => { C.setPendingDirty(false); });
  assert.equal(await useNav.getState().openLearning(), true);
  assert.equal(await useNav.getState().openArticle("s/a.md"), true);
  assert.equal(await useNav.getState().openSection("s"), true);
  assert.equal(await useNav.getState().back(), true);
  assert.deepEqual(useNav.getState().view, { name: "article", rel: "s/a.md" });
  assert.equal(useNav.getState().restoreScroll, 123);
  assert.equal(await useNav.getState().back(), true);
  assert.deepEqual(useNav.getState().view, { name: "learning" });
  assert.equal(await useNav.getState().forward(), true);
  assert.deepEqual(useNav.getState().view, { name: "article", rel: "s/a.md" });
  assert.equal(await useNav.getState().setQuery("rust"), true);
  assert.equal(await useNav.getState().openLearning(), true);
  assert.deepEqual(useNav.getState().view, { name: "learning" });
  assert.equal(useNav.getState().query, "");
  assert.equal(await useNav.getState().setQuery("rust"), true);
  assert.equal(await useNav.getState().goHome(), true);
  assert.deepEqual(useNav.getState().view, { name: "home" });
  assert.equal(useNav.getState().query, "");
  C.registerFlusher(null);
});

test("flush does not treat unresolved dirty state as saved", async () => {
  C.setPendingDirty(true);
  C.registerFlusher(async () => {});
  await assert.rejects(C.flushPending(), /尚未保存/);
  C.setPendingDirty(false); C.registerFlusher(null);
});

test("save queue serializes requests and propagates failure to waiting navigation", async () => {
  let release;
  let active = 0;
  const queue = createSaveQueue(async () => { active++; assert.equal(active, 1); await new Promise((resolve) => { release = resolve; }); active--; });
  const first = queue(); const second = queue();
  release(); await first; await Promise.resolve(); release(); await second;
  let reject;
  const failing = createSaveQueue(() => new Promise((_, fail) => { reject = fail; }));
  const a = failing(); const b = failing();
  const observed = Promise.allSettled([a, b]); reject(new Error("conflict"));
  assert.deepEqual((await observed).map((x) => x.status), ["rejected", "rejected"]);
});

test("watcher echoes match exact revisions rather than a time window", () => {
  C.markSelfSaved("s/a.md", "revision-1");
  assert.equal(C.isSelfSavedEvent("s/a.md", "revision-1"), true);
  assert.equal(C.isSelfSavedEvent("s/a.md", "revision-2"), false);
});
