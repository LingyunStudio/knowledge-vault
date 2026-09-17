/**
 * 行内 `<span style="color:...;background-color:...">` 的解析侧 remark 插件。
 *
 * remark 会把行内 HTML 拆成一段段 `html` 节点（开标签、闭标签各自独立），
 * 这里用栈把「开标签 … 闭标签」之间的内容折叠为自定义 `span` 节点
 * （携带 color / backgroundColor 字段），交给 spanStyle mark 生成 PM 标记。
 *
 * 处理规则：
 * - 嵌套 span 递归配对；未闭合或孤立闭标签保持原样（milkdown 会忽略，
 *   与引入本特性前的行为一致）；
 * - 只认 color / background-color / background 三个声明，其余样式（如
 *   font-size）的 span 不折叠，避免把无关 HTML 变成颜色标记；
 * - 序列化方向不走本插件（milkdown 直接 stringify），由 node.ts 注册的
 *   remark-stringify handler 输出 `<span style="…">`。
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  color?: string | null;
  backgroundColor?: string | null;
  [k: string]: unknown;
}

const OPEN_RE = /^<span(\s[^>]*)?>$/i;
const CLOSE_RE = /^<\/span\s*>$/i;

export function parseSpanStyle(raw: string): { color: string | null; backgroundColor: string | null } {
  // 捕获组是整个 style 属性（含 `style="` 前缀与收尾引号），剥掉后再按声明拆分
  const cleaned = raw
    .trim()
    .replace(/^style\s*=\s*/i, "")
    .replace(/^['"]|['"]$/g, "");
  let color: string | null = null;
  let backgroundColor: string | null = null;
  for (const decl of cleaned.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!value) continue;
    if (key === "color") color = value;
    else if (key === "background-color" || key === "background") backgroundColor = value;
  }
  return { color, backgroundColor };
}

function processChildren(children: MdNode[]): MdNode[] {
  // 先递归处理子级：strong/link 等容器内部同样可能出现 span 序列
  const nodes = children.map((c) =>
    c.children ? { ...c, children: processChildren(c.children) } : c,
  );

  const out: MdNode[] = [];
  const stack: Array<{ node: MdNode; kids: MdNode[] }> = [];

  const flush = (frame: { node: MdNode; kids: MdNode[] }) => {
    frame.node.children = frame.kids;
    const tail = stack.length ? stack[stack.length - 1].kids : out;
    tail.push(frame.node);
  };

  for (const node of nodes) {
    if (node.type === "html") {
      const value = (node.value ?? "").trim();
      const open = OPEN_RE.exec(value);
      if (open) {
        const style = parseSpanStyle(open[1] ?? "");
        if (style.color || style.backgroundColor) {
          stack.push({
            node: { type: "span", color: style.color, backgroundColor: style.backgroundColor },
            kids: [],
          });
          continue;
        }
        // 无颜色声明的 span：按原样保留
      } else if (CLOSE_RE.test(value) && stack.length) {
        flush(stack.pop()!);
        continue;
      }
    }
    if (stack.length) stack[stack.length - 1].kids.push(node);
    else out.push(node);
  }

  // 未闭合：残余内容放回原层级，丢弃样式
  while (stack.length) {
    const frame = stack.pop()!;
    (stack.length ? stack[stack.length - 1].kids : out).push(...frame.kids);
  }
  return out;
}

export function spanStyleRemark() {
  return (tree: unknown) => {
    const root = tree as MdNode;
    if (root.children) root.children = processChildren(root.children);
  };
}
