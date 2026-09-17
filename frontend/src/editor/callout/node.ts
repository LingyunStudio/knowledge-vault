/**
 * callout 的 Milkdown 节点、输入规则与 feature 装配。
 */
import { $inputRule, $nodeSchema, $remark } from "@milkdown/kit/utils";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Editor } from "@milkdown/kit/core";
import { calloutRemark } from "./remark-callout";
import remarkCjkFriendly from "remark-cjk-friendly";

const CALLOUT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]$/;

interface FlowState {
  enter: (name: string) => () => void;
  createTracker: (info: unknown) => {
    move: (text: string) => void;
    shift: (n: number) => void;
    current: () => unknown;
  };
  containerFlow: (
    node: unknown,
    tracker: unknown,
  ) => { value: string };
  indentLines: (input: unknown, map: (line: string, _: number, blank: boolean) => string) => string;
}

const mapQuoteLine = (line: string, _: number, blank: boolean) =>
  ">" + (blank ? "" : " ") + line;

/**
 * blockquote 序列化：callout（首段是独立 `[!KIND]` 标记）手工输出标记行，
 * 避免 remark-stringify 把 `[` 转义成 `\[`；其余引用走默认容器逻辑。
 */
function blockquoteHandler(node: unknown, _parent: unknown, stateAny: unknown, info: unknown): string {
  const state = stateAny as FlowState;
  const n = node as {
    children?: Array<{
      type: string;
      children?: Array<{ type: string; value?: string }>;
    }>;
  };
  const exit = state.enter("blockquote");
  const tracker = state.createTracker(info);

  const first = n.children?.[0];
  const firstText =
    first?.type === "paragraph" &&
    first.children?.[0]?.type === "text"
      ? first.children[0].value
      : undefined;
  let kind: string | null = null;
  if (firstText && CALLOUT_MARKER_RE.test(firstText)) {
    kind = firstText;
  }

  if (kind) {
    // 标记段若还带着正文内联节点（merge 场景），并入 body 的首段
    const extra = (first?.children ?? []).slice(1);
    const rest = (n.children ?? []).slice(1);
    const children =
      extra.length > 0
        ? [{ type: "paragraph", children: extra }, ...rest]
        : rest;
    const bodyNode = { ...n, children };
    tracker.move("> ");
    tracker.shift(2);
    const bodyVal = state.indentLines(
      state.containerFlow(bodyNode, tracker.current()),
      mapQuoteLine,
    );
    exit();
    return `> ${kind}\n${bodyVal}`;
  }

  tracker.move("> ");
  tracker.shift(2);
  const value = state.indentLines(
    state.containerFlow(n, tracker.current()),
    mapQuoteLine,
  );
  exit();
  return value;
}

const remarkPlugin = $remark("kvCalloutRemark", () => calloutRemark);
// 让 **加粗** 在全角标点/CJK 相邻时仍按强调解析（对齐旧版 pulldown 行为）
const cjkPlugin = $remark("cjkFriendly", () => remarkCjkFriendly);

interface CalloutMdNode {
  type: string;
  calloutKind?: string;
  children?: unknown;
}

const calloutNode = $nodeSchema("callout", () => ({
  content: "block+",
  group: "block",
  defining: true,
  attrs: {
    kind: { default: "note" },
  },
  parseDOM: [
    {
      tag: "div[data-callout-kind]",
      getAttrs: (dom) => ({
        kind: (dom as HTMLElement).dataset.calloutKind || "note",
      }),
    },
  ],
  toDOM: (node) => [
    "div",
    {
      class: "callout",
      "data-callout-kind": node.attrs.kind,
    },
    0,
  ],
  parseMarkdown: {
    match: (node: CalloutMdNode) => node.type === "kv-callout",
    runner: (state, node, type) => {
      const kind = node.calloutKind ?? "note";
      state.openNode(type, { kind }).next(node.children).closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "callout",
    runner: (state, node) => {
      // 直接产出普通 blockquote + 标记段，避免 stringify 阶段出现未知节点
      // （milkdown 序列化不跑 remark transform 插件）
      const kind = String(node.attrs.kind ?? "note").toUpperCase();
      state
        .openNode("blockquote")
        .addNode("paragraph", [{ type: "text", value: `[!${kind}]` }])
        .next(node.content)
        .closeNode();
    },
  },
}));

/** 在引用块里输入 `[!NOTE] ` 后，即时转换为 callout。 */
const calloutInputRule = $inputRule((ctx) =>
  new InputRule(
    /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]\s$/i,
    (
      state: EditorState,
      match: RegExpMatchArray,
      start: number,
      end: number,
    ): Transaction | null => {
      const calloutType = calloutNode.type(ctx);
      const bqType = calloutType.schema.nodes.blockquote;
      const { $from } = state.selection;
      let bqStart = -1;
      let bqNode: ProseNode | null = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === bqType) {
          bqStart = $from.before(d);
          bqNode = $from.node(d);
          break;
        }
      }
      if (!bqNode || bqStart < 0) return null;
      const kind = match[1].toLowerCase();

      const tr = state.tr;
      tr.delete(start, end); // 连标记带结尾空格一起删掉
      const bqEnd = tr.mapping.map(bqStart + bqNode.nodeSize);
      const fresh = tr.doc.nodeAt(bqStart);
      if (!fresh) return null;
      const kids: ProseNode[] = [];
      fresh.forEach((n) => kids.push(n));
      let content = kids;
      if (kids[0]?.isTextblock && kids[0].content.size === 0) {
        content = kids.slice(1);
      }
      if (content.length === 0) {
        content = [calloutType.schema.nodes.paragraph.create()];
      }

      tr.replaceRangeWith(
        bqStart,
        bqEnd,
        calloutType.create({ kind }, content),
      );
      return tr;
    },
  ),
);

/** Crepe feature：插入 remark 双向插件、节点、输入规则，并收敛序列化风格。 */
export function calloutFeature(editor: Editor): void {
  editor
    .config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        fences: true,
        bullet: "-" as const,
        bulletOrdered: "." as const,
        listItemIndent: "one" as const,
        rule: "-" as const,
        setext: false,
        handlers: {
          ...prev.handlers,
          blockquote: blockquoteHandler,
        },
      }));
    })
    .use(remarkPlugin)
    .use(cjkPlugin)
    .use(calloutNode)
    .use(calloutInputRule);
}
