/**
 * GFM alert（GitHub 风格 callout）解析侧 remark 插件。
 *
 * 解析方向（milkdown 用 runSync）：带 `[!NOTE]` 标记的 blockquote →
 * kv-callout，交给自定义 ProseMirror 节点渲染。
 * 序列化方向不走 remark 插件（milkdown 直接 stringify，不 run transform），
 * 由 node.ts 的 toMarkdown runner 直接产出含标记段的普通 blockquote。
 */
import { visit } from "unist-util-visit";

export const CALLOUT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "danger",
] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  calloutKind?: string;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

export function calloutRemark() {
  // 参数用 unknown 以匹配 remark Transformer<Root, Root>，内部再收窄
  return (tree: unknown) => {
    const root = tree as MdNode;
    // 解析方向：blockquote(标记) → kv-callout
    visit(root, "blockquote", (raw) => {
      const node = raw as MdNode;
      const para = node.children?.[0];
      if (!para || para.type !== "paragraph" || !para.children?.length) return;
      const firstText = para.children.find((c) => c.type === "text");
      if (!firstText || firstText.value === undefined) return;
      const head = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]/i.exec(
        firstText.value,
      );
      if (!head) return;

      const restValue = firstText.value.slice(head[0].length).replace(/^\s+/, "");
      const kids = para.children.slice();
      const idx = kids.indexOf(firstText);
      kids.splice(idx, 1);
      // 标记独占一行时，吃掉后面的软换行节点
      if (kids[idx] && kids[idx].type === "break") kids.splice(idx, 1);
      // 标记与正文挤在同一行（GitHub 语法之外的宽容处理）
      if (restValue) kids.splice(idx, 0, { type: "text", value: restValue });

      const restPara = kids.length ? [{ ...para, children: kids }] : [];
      node.type = "kv-callout";
      node.calloutKind = head[1].toLowerCase();
      node.children = [...restPara, ...(node.children ?? []).slice(1)];
    });
  };
}
