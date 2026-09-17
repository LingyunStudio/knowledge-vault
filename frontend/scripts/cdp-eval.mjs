// CDP 驱动：连接 WebView2 调试端口，执行 JS 表达式并输出结果。
// 用法: node cdp-eval.mjs "expression"   （表达式可 async，自动 awaitPromise）
const port = process.env.CDP_PORT || "9223";

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const titleFilter = process.env.CDP_TITLE;
const urlFilter = process.env.CDP_URL;
const urlExclude = process.env.CDP_URL_EXCLUDE ?? "";
const candidates = list.filter(
  (t) =>
    t.type === "page" &&
    (!urlFilter || (t.url || "").includes(urlFilter)) &&
    (!urlExclude || !(t.url || "").includes(urlExclude)),
);
const page =
  candidates[0] ??
  (titleFilter
    ? list.find((t) => t.type === "page" && (t.title || "").includes(titleFilter))
    : list.find((t) => t.type === "page"));
if (!page) {
  console.error("no page target");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error("ws connect failed"));
});

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) {
    const { res, rej } = pending.get(d.id);
    pending.delete(d.id);
    d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
  }
};
const call = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

import { readFileSync } from "node:fs";
let expr = process.argv[2];
if (expr?.startsWith("@")) {
  expr = readFileSync(expr.slice(1), "utf-8");
}
const evalTimeout = Number(process.env.CDP_TIMEOUT || 25000);
const result = await Promise.race([
  call("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  }),
  new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`evaluate timeout (${evalTimeout}ms)`)), evalTimeout),
  ),
]);
if (result.exceptionDetails) {
  console.error(
    "EXCEPTION:",
    result.exceptionDetails.exception?.description ??
      JSON.stringify(result.exceptionDetails),
  );
  process.exit(2);
}
console.log(JSON.stringify(result.result?.value, null, 1));
ws.close();
process.exit(0);
