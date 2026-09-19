import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function moduleUrl(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
const { moveItem, insertIndexFor } = await import(await moduleUrl("../src/lib/reorder.ts"));

test("moveItem moves forward: insert before a later card keeps order of the rest", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], "a", 2), ["b", "a", "c", "d"]);
});

test("moveItem moves to the end using an insert position past the last card", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], "a", 3), ["b", "c", "a"]);
});

test("moveItem moves backward", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
});

test("moveItem is a no-op when dropped onto itself or an adjacent slot", () => {
  assert.equal(moveItem(["a", "b"], "a", 1), null, "落在自己之后等于原地");
  assert.equal(moveItem(["a", "b"], "b", 1), null, "落在自己之前等于原地");
  assert.deepEqual(moveItem(["a", "b", "c"], "b", 1), null);
});

test("moveItem returns null for unknown ids or out-of-range insert positions", () => {
  assert.equal(moveItem(["a", "b"], "x", 0), null);
  assert.equal(moveItem(["a", "b"], "a", -1), null);
  assert.equal(moveItem(["a", "b"], "a", 99), null);
});

test("insertIndexFor maps the hovered half of a card to an insert slot", () => {
  assert.equal(insertIndexFor(0, true), 0, "前半部落入该卡片之前");
  assert.equal(insertIndexFor(0, false), 1, "后半部落入该卡片之后");
  assert.equal(insertIndexFor(4, false), 5);
});
