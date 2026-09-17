import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const urlOf = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  source = source.replace(/^import .*\.css";$/gm, "");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(`"${from}"`, `"${to}"`);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  return urlOf(outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime"))));
}
const searchUrl = await moduleUrl("../src/lib/search.ts");
const { searchArticles, searchTerms, highlightRanges } = await import(searchUrl);
const article = (overrides = {}) => ({
  rel: "rust/one.md", fileName: "one.md", secId: "rust", group: null,
  title: "A note", summary: "", order: 0, tags: [], mtimeMs: 0, plain: "", ...overrides,
});

test("tag-only results are included with a full preview and no body hit", () => {
  const a = article({ tags: ["Ownership"], plain: "A useful introductory note." });
  const [hit] = searchArticles([a], "OWNER");
  assert.equal(hit.art, a);
  assert.equal(hit.score, 50);
  assert.equal(hit.hitAt, -1);
  assert.equal(hit.snippet, a.plain);
});
test("multiple terms use AND across fields, case-insensitively and without duplicate weight", () => {
  const a = article({ title: "Rust", tags: ["ownership"], plain: "Borrowing is useful" });
  assert.equal(searchArticles([a], " RUST\townership\nborrowing ").length, 1);
  assert.equal(searchArticles([a], "rust missing").length, 0);
  assert.equal(searchArticles([a], "rust rust")[0].score, 100);
  assert.deepEqual(searchTerms(" RUST rust\t所有权 "), ["rust", "所有权"]);
  assert.deepEqual(searchArticles([a], " \n "), []);
});
test("board and exact tag filters combine without confusing substring tags", () => {
  const articles = [article({ tags: ["Rust"], plain: "match" }), article({ secId: "cpp", tags: ["Rust"], plain: "match" }), article({ tags: ["rustacean"], plain: "match" })];
  assert.equal(searchArticles(articles, "match", { secId: "rust", tag: "RUST" }).length, 1);
  assert.equal(searchArticles(articles, "match", { tag: "rust" }).length, 2);
  assert.equal(searchArticles(articles, "match", { secId: "missing" }).length, 0);
});
test("all results survive the old 60 cap and ties preserve input order", () => {
  const articles = Array.from({ length: 125 }, (_, i) => article({ rel: `${i}.md`, plain: "match" }));
  const hits = searchArticles(articles, "match");
  assert.equal(hits.length, 125);
  assert.deepEqual(hits.map((hit) => hit.art.rel), articles.map((a) => a.rel));
  assert.deepEqual(articles.map((a) => a.plain), Array(125).fill("match"));
});
test("title outranks tag which outranks ordinary body matches", () => {
  const articles = [article({ plain: "match match", rel: "body" }), article({ tags: ["match"], rel: "tag" }), article({ title: "match", rel: "title" })];
  assert.deepEqual(searchArticles(articles, "match").map((h) => h.art.rel), ["title", "tag", "body"]);
});
test("snippets have correct offsets after whitespace normalization and truncation", () => {
  const [hit] = searchArticles([article({ plain: "  intro\n\t" + "a".repeat(50) + " match " + "z".repeat(90) })], "match");
  assert.equal(hit.snippet.slice(hit.hitAt, hit.hitAt + 5), "match");
  assert.ok(hit.snippet.startsWith("…"));
  assert.ok(hit.snippet.endsWith("…"));
  assert.equal(searchArticles([article({ title: "match" })], "match")[0].snippet, "");
});
test("highlight ranges support literal punctuation, Chinese, overlapping and repeated matches", () => {
  assert.deepEqual(highlightRanges("C++ 所有权", ["c++", "所有权"]), [[0, 3], [4, 7]]);
  assert.deepEqual(highlightRanges("banana", ["ana", "nan"]), [[1, 6]]);
  assert.deepEqual(highlightRanges("rust rust", ["rust", ""]), [[0, 4], [5, 9]]);
});

// Component acceptance tests use mock stores / IPC only; no knowledge files or browser.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const calls = [];
const state = { query: "match", data: null, rescan: async () => calls.push(["rescan"]), openArticle: async (...args) => calls.push(["article", ...args]), openSection: async (...args) => calls.push(["section", ...args]) };
globalThis.__searchTest = { state, create: async (...args) => { calls.push(["create", ...args]); return { rel: "rust/new.md" }; } };
const storeUrl = urlOf(`export const useLibrary = selector => selector(globalThis.__searchTest.state); export const useNav = useLibrary; export const sectionArticles = (data, id) => data.articles.filter(a => a.secId === id);`);
const common = { react: import.meta.resolve("react"), "../../store/library": storeUrl, "../../store/nav": storeUrl };
const { SearchPage } = await import(await moduleUrl("../src/components/pages/SearchPage.tsx", { ...common, "../../lib/search": searchUrl }));
const { SectionPage } = await import(await moduleUrl("../src/components/pages/SectionPage.tsx", {
  ...common,
  "../../lib/ipc": urlOf("export const ipc = { createArticle: (...args) => globalThis.__searchTest.create(...args) };"),
  "../../lib/format": urlOf("export const readingMinutes = () => 1;"),
  "../article/SectionLogo": urlOf("export const SectionLogo = () => null;"),
}));
const sections = [{ id: "rust", name: "Rust", desc: "", glyph: "", brand: null, order: 0, hasCover: false }, { id: "cpp", name: "C++", desc: "", glyph: "", brand: null, order: 1, hasCover: false }];
async function mount(Component, props = {}) {
  const el = document.createElement("div"); document.body.append(el);
  const root = createRoot(el);
  const render = () => act(async () => root.render(React.createElement(Component, props)));
  await render();
  return { el, render, close: async () => { await act(async () => root.unmount()); el.remove(); } };
}
async function click(button) { await act(async () => button.click()); }
async function select(el, value) { await act(async () => { el.value = value; el.dispatchEvent(new window.Event("change", { bubbles: true })); }); }

test("search UI paginates accurate totals, resets for query/filters, and routes clickable paths", async () => {
  calls.length = 0;
  state.query = "match";
  state.data = { sections, articles: Array.from({ length: 65 }, (_, i) => article({ rel: `rust/${i}.md`, fileName: `${i}.md`, plain: "match", tags: [i % 2 ? "odd" : "even"] })) };
  const ui = await mount(SearchPage);
  try {
    assert.match(ui.el.querySelector('[role="status"]').textContent, /65 个结果.*1–20/);
    assert.equal(ui.el.querySelectorAll(".search-row").length, 20);
    const next = () => [...ui.el.querySelectorAll("button")].find((b) => b.textContent === "下一页");
    await click(next()); await click(next()); await click(next());
    assert.equal(ui.el.querySelectorAll(".search-row").length, 5);
    assert.equal(next().disabled, true);
    await select(ui.el.querySelectorAll("select")[1], "even");
    assert.match(ui.el.querySelector('[role="status"]').textContent, /33 个结果.*1–20/);
    await click(next());
    state.query = "match match"; await ui.render();
    assert.match(ui.el.querySelector('[role="status"]').textContent, /1–20/);
    const path = ui.el.querySelectorAll(".search-path button");
    await click(path[0]); await click(path[1]);
    assert.deepEqual(calls, [["section", "rust"], ["article", "rust/0.md", "rust", null]]);
    await select(ui.el.querySelectorAll("select")[0], "cpp");
    assert.match(ui.el.querySelector('[role="status"]').textContent, /0 个结果/);
    assert.equal(ui.el.querySelectorAll("select")[1].value, "even");
    await click(ui.el.querySelector(".search-filter-clear"));
    assert.equal(ui.el.querySelectorAll(".search-row").length, 20);
  } finally { await ui.close(); }
});
test("empty section create locks double clicks, rescans, then navigates", async () => {
  calls.length = 0;
  state.data = { sections, articles: [] };
  let finish;
  globalThis.__searchTest.create = (...args) => { calls.push(["create", ...args]); return new Promise((resolve) => { finish = resolve; }); };
  const ui = await mount(SectionPage, { sectionId: "rust" });
  try {
    const button = ui.el.querySelector("button");
    await act(async () => { button.click(); button.click(); });
    assert.equal(button.disabled, true);
    assert.deepEqual(calls, [["create", "rust", "新文章"]]);
    await act(async () => finish({ rel: "rust/new.md" }));
    assert.deepEqual(calls, [["create", "rust", "新文章"], ["rescan"], ["article", "rust/new.md", "rust", null]]);
  } finally { await ui.close(); }
});
test("empty section reports create errors and allows retry", async () => {
  state.data = { sections, articles: [] };
  globalThis.__searchTest.create = async () => { throw new Error("read only"); };
  const ui = await mount(SectionPage, { sectionId: "rust" });
  try {
    await click(ui.el.querySelector("button"));
    assert.match(ui.el.textContent, /read only/);
    assert.equal(ui.el.querySelector("button").disabled, false);
  } finally { await ui.close(); }
});
