/**
 * 文字颜色 / 背景色：自定义 spanStyle mark 与 markdown 双向映射。
 *
 * markdown 表示采用 Typora 兼容的行内 HTML：
 *   `<span style="color:#b23a26">红字</span>`
 *   `<span style="background-color:#fde68a">高亮</span>`
 * 两种属性合并在同一个 mark（attrs.color / attrs.backgroundColor），
 * 序列化时注册 remark-stringify 的 `span` handler 直接输出 HTML。
 */
import {
  editorViewCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
  type Editor,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { $markSchema } from "@milkdown/kit/utils";
import { spanStyleRemark } from "./remark-span-style";

interface SpanMdNode {
  type: string;
  color?: string | null;
  backgroundColor?: string | null;
  children?: unknown;
}

export function composeSpanStyle(attrs: {
  color?: string | null;
  backgroundColor?: string | null;
}): string {
  const parts: string[] = [];
  if (attrs.color) parts.push(`color:${attrs.color}`);
  if (attrs.backgroundColor) parts.push(`background-color:${attrs.backgroundColor}`);
  return parts.join(";");
}

export const spanStyleMark = $markSchema("spanStyle", () => ({
  attrs: {
    color: { default: null },
    backgroundColor: { default: null },
  },
  inclusive: true,
  parseDOM: [
    {
      tag: "span[style]",
      getAttrs: (dom) => {
        const style = (dom as HTMLElement).style;
        const color = style.color || null;
        const backgroundColor = style.backgroundColor || null;
        return color || backgroundColor ? { color, backgroundColor } : false;
      },
    },
  ],
  toDOM: (mark) => [
    "span",
    { style: composeSpanStyle(mark.attrs), "data-span-style": "" },
    0,
  ],
  parseMarkdown: {
    match: (node: SpanMdNode) => node.type === "span",
    runner: (state, node, type) => {
      state.openMark(type, {
        color: node.color ?? null,
        backgroundColor: node.backgroundColor ?? null,
      });
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "spanStyle",
    runner: (state, mark) => {
      state.withMark(mark, "span", undefined, {
        color: mark.attrs.color,
        backgroundColor: mark.attrs.backgroundColor,
      });
    },
  },
}));

const spanStyleRemarkEntry = { plugin: spanStyleRemark, options: {} };

/** 当前选区（或光标处 stored mark）是否带有指定样式属性。 */
export function hasSpanStyleAttr(ctx: Ctx, attr: "color" | "backgroundColor"): boolean {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { empty, $from } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : $from.marks();
  const mark = marks.find((m: { type: { name: string }; attrs?: Record<string, unknown> }) => m.type.name === "spanStyle");
  return Boolean(mark?.attrs?.[attr]);
}

/** 注册 remark 双向插件与 mark schema，并收敛序列化 handler。 */
export function spanStyleFeature(editor: Editor): void {
  editor
    .config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        handlers: {
          ...prev.handlers,
          // milkdown 序列化不跑 remark transform，这里直接把自定义 span
          // 节点写成行内 HTML（与 callout 的 blockquote handler 同套路）
          span: (node: SpanMdNode, _parent: unknown, state: any, info: unknown) => {
            const style = composeSpanStyle(node);
            const value = state.containerPhrasing(node, info);
            return style ? `<span style="${style}">${value}</span>` : value;
          },
        },
      }));
      // 解析侧变换直接注入 remarkPluginsCtx：config 回调在 init 完成前同步执行，
      // 必然早于 schema 阶段的 remark 处理器构建（$remark 的定时器唤醒存在竞态）
      ctx.update(remarkPluginsCtx, (rp) => [...rp, spanStyleRemarkEntry]);
    })
    .use(spanStyleMark);
}
