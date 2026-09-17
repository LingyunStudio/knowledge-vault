import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// 追加的 store 依赖全部解析到本地 node_modules；纯 helper 无 Tauri/网络调用。
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.split(`"${from}"`).join(`"${to}"`);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const frontmatterUrl = await moduleUrl("../src/lib/frontmatter.ts");
const typesUrl = await moduleUrl("../src/lib/types.ts");
const learningUrl = await moduleUrl("../src/lib/ai-learning.ts", {
  "./types": typesUrl,
  "./frontmatter": frontmatterUrl,
});
const L = await import(learningUrl);

const articles = [
  { rel: "sec/a.md", fileName: "a.md", group: null, secId: "sec", title: "所有权与借用", summary: "", order: 1, tags: ["rust"], mtimeMs: 0, plain: "Ownership means every value has one owner. 所有权是 Rust 的核心概念。" },
  { rel: "sec/b.md", fileName: "b.md", group: null, secId: "sec", title: "生命周期", summary: "", order: 2, tags: [], mtimeMs: 0, plain: "Lifetime annotations describe how long references stay valid. 生命周期标注。" },
  { rel: "sec/c.md", fileName: "c.md", group: null, secId: "sec", title: "无关系", summary: "", order: 3, tags: [], mtimeMs: 0, plain: "Completely unrelated content about cooking pasta." },
];

test("retrieveSources ranks keyword matches, includes snippets, never returns unsafe rels", () => {
  const hits = L.retrieveSources(articles, "什么是所有权？");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].rel, "sec/a.md");
  assert.ok(hits[0].snippet.includes("所有权"));
  assert.deepEqual(L.retrieveSources(articles, "ownership borrowing").map((h) => h.rel), ["sec/a.md"]);
  assert.ok(!L.retrieveSources(articles, "ownership").some((h) => h.rel === "sec/c.md"));
  assert.deepEqual(L.retrieveSources(articles, "???"), []);
  const unsafe = [{ ...articles[0], rel: "../outside.md" }];
  assert.deepEqual(L.retrieveSources(unsafe, "ownership"), []);
});

test("learningPrompt embeds numbered sources with links and anti-fabrication rules", () => {
  const sources = [{ rel: "sec/a.md", title: "所有权", snippet: "Owner 是唯一持有者" }];
  const p = L.learningPrompt("library", sources);
  assert.match(p, /资料库关键词检索/);
  assert.match(p, /不得编造/);
  assert.match(p, /https:\/\/knowledge-vault\.invalid\/article\/sec%2Fa\.md/);
  assert.match(p, /来源 1/);
  assert.doesNotMatch(L.learningPrompt("library", []), /来源 1/);
  assert.match(L.learningPrompt("library", []), /无法依据资料回答|不要捏造/);
  // 资料内容里出现指令注入字样时，提示必须声明资料不是指令
  assert.match(p, /不是指令/);
});

test("source href/round-trip only accepts provided sources", () => {
  const sources = [{ rel: "sec/a.md", title: "A", snippet: "" }];
  const href = L.sourceHref("sec/a.md");
  assert.equal(L.sourceRel(href, sources), "sec/a.md");
  // 伪造链接不在本次来源列表中，点击不会跳转
  assert.equal(L.sourceRel(L.sourceHref("sec/b.md"), sources), null);
  assert.equal(L.sourceRel("https://evil.example/x", sources), null);
});

test("textOnly strips image data URIs and enforces the limit", () => {
  const dirty = `看图 ![](data:image/png;base64,AAAA) 结束`;
  assert.ok(!L.textOnly(dirty).includes("data:image"));
  assert.match(L.textOnly(dirty), /图片数据未保存/);
  const long = "x".repeat(L.MAX_TEXT + 100);
  assert.ok(L.textOnly(long).length < L.MAX_TEXT + 30);
  assert.match(L.textOnly(long), /已截断/);
});

test("boundedSessions drops image blobs, oversize histories and stale sessions deterministically", () => {
  const blob = `data:image/png;base64,${"A".repeat(40000)}`;
  const sessions = [
    { id: "old", rootPath: "C:/k", articleRel: "s/a.md", title: "旧", updatedAt: 1, messages: Array.from({ length: 60 }, (_, i) => ({ role: "user", content: `m${i}`, scope: "article" })) },
    { id: "new", rootPath: "C:/k", articleRel: "s/a.md", title: "新", updatedAt: 2, messages: [{ role: "assistant", content: blob, scope: "article", sources: [{ rel: "s/a.md", title: "A", snippet: "x".repeat(9999) }] }] },
  ];
  const out = L.boundedSessions(sessions);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "new");
  assert.ok(!JSON.stringify(out).includes("AAAA"));
  assert.equal(out[1].messages.length, L.MAX_MESSAGES);
  assert.equal(out[0].messages.length, 1);
  assert.equal(out[0].messages[0].sources[0].snippet, "");
  const serialized = JSON.stringify({ version: 1, sessions: out });
  assert.ok(serialized.length <= L.MAX_STORAGE_CHARS);
});

test("persistSessions survives quota failure and loadSessions rejects corrupt payloads without overwriting", () => {
  const throwing = { setItem() { throw new Error("quota"); }, getItem: () => null };
  assert.match(L.persistSessions(throwing, []), /配额/);
  const good = { getItem: () => null, setItem: (k, v) => { this.saved = v; } };
  const saved = [];
  const memory = { getItem: (k) => (k === L.SESSION_KEY ? saved[0] ?? null : null), setItem: (k, v) => { saved[0] = v; } };
  const sessions = [{ id: "s1", rootPath: "C:/k", articleRel: "s/a.md", title: "t", updatedAt: 5, messages: [{ role: "user", content: "hi", scope: "article" }] }];
  assert.equal(L.persistSessions(memory, sessions), null);
  assert.equal(L.loadSessions(memory).sessions.length, 1);
  assert.equal(L.loadSessions(memory).error, null);
  // 损坏数据：报错且绝不用空列表覆盖
  for (const raw of ["{", JSON.stringify({ version: 2, sessions: [] }), JSON.stringify({ version: 1, sessions: [{ id: 1 }] }), JSON.stringify({ version: 1, sessions: [{ id: "x", rootPath: "", articleRel: "", title: "", updatedAt: 1, messages: [] }] })]) {
    const bad = { getItem: () => raw, setItem: () => { throw new Error("must not write"); } };
    assert.notEqual(L.loadSessions(bad).error, null);
  }
  assert.equal(saved.length, 1); // 原数据未被覆盖
});

test("saveAnswerNote creates the note from the fresh skeleton, writes once with revision, and reports partial creations", async () => {
  const calls = [];
  const skeleton = { rel: "sec/ai-note.md", fmRaw: "title: AI 笔记", title: "AI 笔记", summary: "", order: 0, tags: [], body: "", mtimeMs: 1, revision: "r1" };
  const api = {
    libraryRoot: async () => ({ path: "C:/k", source: "dev", writable: true }),
    createArticle: async (secId, title) => { calls.push(["create", secId, title]); return { rel: "sec/ai-note.md" }; },
    readArticle: async (rel) => { calls.push(["read", rel]); return skeleton; },
    writeArticle: async (rel, content, mtime, revision) => { calls.push(["write", rel, content, mtime, revision]); },
  };
  const answer = { role: "assistant", content: "结论 [1](https://knowledge-vault.invalid/article/sec%2Fa.md)。",
    scope: "library", sources: [{ rel: "sec/a.md", title: "所有权", snippet: "" }] };
  const rel = await L.saveAnswerNote(api, "C:/k", "sec", "AI 笔记 - 所有权", answer);
  assert.equal(rel, "sec/ai-note.md");
  const write = calls.find((c) => c[0] === "write");
  assert.equal(write[3], 1);
  assert.equal(write[4], "r1");
  assert.match(write[2], /\(a\.md\)/);
  assert.match(write[2], /## 来源/);
  assert.doesNotMatch(write[2], /knowledge-vault\.invalid/);
  // 没有任何隐式调用：create 只发生一次，read/write 各一次
  assert.equal(calls.filter((c) => c[0] === "create").length, 1);
  // 创建成功但写入失败：错误里明确指出已创建的文件，且不自动删除
  const failing = { ...api, writeArticle: async () => { throw new Error("disk full"); } };
  await assert.rejects(L.saveAnswerNote(failing, "C:/k", "sec", "t", answer), /已创建笔记 sec\/ai-note\.md/);
  // 资料库被切换：拒绝写入
  const switched = { ...api, libraryRoot: async () => ({ path: "D:/other", source: "", writable: true }) };
  await assert.rejects(L.saveAnswerNote(switched, "C:/k", "sec", "t", answer), /资料库已切换/);
  // 只读库：拒绝
  const readonly = { ...api, libraryRoot: async () => ({ path: "C:/k", source: "", writable: false }) };
  await assert.rejects(L.saveAnswerNote(readonly, "C:/k", "sec", "t", answer), /只读/);
});

test("composeAnswerNote keeps the created skeleton and appends sources, never regenerates front matter", () => {
  const skeleton = { rel: "sec/n.md", fmRaw: "title: AI 笔记", title: "AI 笔记", summary: "", order: 0, tags: [], body: "", mtimeMs: 0, revision: "r" };
  const md = L.composeAnswerNote(skeleton, { role: "assistant", content: "正文", scope: "article", sources: [{ rel: "sec/a b.md", title: "带空格 [注]", snippet: "" }] });
  assert.match(md, /^---\ntitle: AI 笔记\n---/);
  assert.match(md, /AI 生成的学习笔记/);
  assert.match(md, /\(a%20b\.md\)/);
  assert.match(md, /带空格\s+注/);
});

test("sameRoot tolerates case and separator differences; session scoping keys on root+rel", () => {
  assert.ok(L.sameRoot("C:\\Learning\\knowledge", "c:/learning/knowledge"));
  assert.ok(!L.sameRoot("C:/k", "D:/k"));
  assert.ok(L.sessionMatches({ id: "x", rootPath: "C:/k", articleRel: "a.md", title: "", updatedAt: 0, messages: [] }, "c:\\k", "a.md"));
  assert.ok(!L.sessionMatches({ id: "x", rootPath: "C:/k", articleRel: "a.md", title: "", updatedAt: 0, messages: [] }, "C:/k", "b.md"));
});
