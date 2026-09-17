/** 同目录 .md 相对链接解析（库内 266 处内链全是此形态）。 */

export function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

/**
 * 把链接 href 解析为库内 rel；非 .md 相对链接返回 null。
 * 形如 `04-ownership.md`、`./x.md`，锚点 `#frag` 去掉。
 */
export function resolveMdLink(currentRel: string, href: string): string | null {
  let h = href.trim();
  if (!h.endsWith(".md")) {
    // 可能带锚点
    if (!/\.md(#|$)/i.test(h)) return null;
    h = h.split("#")[0];
  } else {
    h = h.split("#")[0];
  }
  if (!h || /^https?:/i.test(h) || h.startsWith("/")) return null;
  const base = dirOf(currentRel).split("/");
  for (const seg of h.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  return base.join("/");
}

export function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
