/**
 * 极简 Markdown → HTML 渲染器，用于 AI 回复展示。
 * 先整体 HTML 转义再打标记，AI 输出无法注入标签；支持 AI 常用的
 * 围栏代码、标题、列表、引用、表格与行内粗体/代码/删除线/链接。
 */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** 行内标记（输入必须已转义）。 */
function inline(s: string): string {
  let out = "";
  let rest = s;
  // 依次切分 `code`，代码段内不做其他标记
  const codeRe = /`([^`]+)`/;
  while (rest) {
    const m = codeRe.exec(rest);
    if (!m) {
      out += marks(rest);
      break;
    }
    out += marks(rest.slice(0, m.index));
    out += `<code>${m[1]}</code>`;
    rest = rest.slice(m.index + m[0].length);
  }
  return out;

  function marks(t: string): string {
    return t
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      // 图片：仅放行 http(s) 与 data:image 源，其余退化为 alt 文本
      .replace(
        /!\[([^\]]*)\]\(([^)\s]+)\)/g,
        (_whole, alt: string, src: string) =>
          /^(https?:|data:image\/)/.test(src)
            ? `<img src="${src}" alt="${alt}">`
            : alt,
      )
      .replace(
        /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      );
  }
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

export function renderMarkdownLite(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码
    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      out.push(
        `<pre${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(
          body.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length + 1, 6); // 回复整体降一级，h1 留给文章标题
      out.push(`<h${lvl}>${inline(esc(h[2]))}</h${lvl}>`);
      i++;
      continue;
    }

    // 水平线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // 引用（连续 > 合并）
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdownLite(body.join("\n"))}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${head
          .map((c) => `<th>${inline(esc(c))}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
      continue;
    }

    // 列表（按缩进嵌套）
    const liRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (liRe.test(line)) {
      type Node = { text: string; ordered: boolean; indent: number; children: Node[] };
      const roots: Node[] = [];
      const stack: Node[] = [];
      while (i < lines.length && liRe.test(lines[i])) {
        const m = liRe.exec(lines[i])!;
        const ordered = /\d/.test(m[2]);
        const node: Node = { text: m[3], ordered, indent: m[1].length, children: [] };
        while (stack.length && stack[stack.length - 1].indent >= node.indent) {
          stack.pop();
        }
        if (stack.length === 0) roots.push(node);
        else stack[stack.length - 1].children.push(node);
        stack.push(node);
        i++;
      }
      const renderList = (nodes: Node[], ordered: boolean): string => {
        const tag = ordered ? "ol" : "ul";
        return `<${tag}>${nodes
          .map(
            (n) =>
              `<li>${inline(esc(n.text))}${
                n.children.length
                  ? renderList(n.children, n.children[0].ordered)
                  : ""
              }</li>`,
          )
          .join("")}</${tag}>`;
      };
      out.push(renderList(roots, roots[0]?.ordered ?? false));
      continue;
    }

    // 普通段落（连续非空行合并）
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(esc(para.join("\n"))).replace(/\n/g, "<br>")}</p>`);
  }

  return out.join("");
}
