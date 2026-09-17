/**
 * 编辑器动作层：快捷键与右键菜单共用的命令封装。
 * 全部通过 milkdown 的 commandsCtx / editorViewCtx 惰性取用，
 * 在编辑器 create 之后再调用也安全。
 */
import {
  commandsCtx,
  editorViewCtx,
  type CmdKey,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  createCodeBlockCommand,
  insertHrCommand,
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  insertTableCommand,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state";
import { spanStyleMark } from "./span-style/node";
import { openTablePicker } from "./table-picker";

export interface EditorActions {
  undo(): void;
  redo(): void;
  /** 转为 N 级标题（level 取 1-6） */
  heading(level: number): void;
  /** 转为正文段落 */
  paragraph(): void;
  /** 标题等级 +/-：无标题时升为 H1，H1 再降则回正文 */
  bumpHeading(delta: number): void;
  bulletList(): void;
  orderedList(): void;
  blockquote(): void;
  codeBlock(): void;
  hr(): void;
  /** 弹出行列选择器，确认后插入表格（行数含表头） */
  pickTable(anchor: { x: number; y: number }): void;
  /** 直接按行列插入表格（行数含表头；越界值收敛到 1..20） */
  insertTable(rows: number, cols: number): void;
  /** 旧入口：右键菜单用，以菜单出现位置为锚点弹选择器 */
  table(anchor?: { x: number; y: number }): void;
  bold(): void;
  italic(): void;
  strikethrough(): void;
  inlineCode(): void;
  /** 选中内容加链接（再按一次取消） */
  link(): void;
  /** 设置/清除文字颜色（null 清除；另一属性保留） */
  setTextColor(color: string | null): void;
  /** 设置/清除背景色（null 清除；另一属性保留） */
  setBackgroundColor(color: string | null): void;
  /** 清除选区内所有行内格式（保留块级结构） */
  clearFormat(): void;
  sinkList(): void;
  liftList(): void;
  selectAll(): void;
  paste(): void;
  pasteAsPlain(): void;
  /** 右键落在非选中区域时把光标移过去；返回是否移动过 */
  placeCaretAt(x: number, y: number): boolean;
  /** 目标是否处于内嵌 CodeMirror 代码块内 */
  insideCodeMirror(target: EventTarget | null): boolean;
}

export function createEditorActions(ctx: Ctx): EditorActions {
  const call = <T>(key: CmdKey<T>, payload?: T) =>
    ctx.get(commandsCtx).call(key, payload);

  const view = () => ctx.get(editorViewCtx);

  const headingLevelInRange = (): number | null => {
    const v = view();
    const { state } = v;
    const { from, to } = state.selection;
    // AllSelection 时 $from.depth 为 0，改扫选区覆盖的节点
    let level: number | null = null;
    state.doc.nodesBetween(from, Math.max(to, from + 1), (node) => {
      if (level == null && node.type.name === "heading") {
        level = node.attrs.level as number;
        return false;
      }
      return node.type.name !== "text";
    });
    return level;
  };

  const readClipboard = async (): Promise<string> => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      // WebView 剪贴板权限被拒时放弃，原生 Ctrl+V 仍可用
      return "";
    }
  };

  /**
   * 设置/清除 spanStyle 的单个属性，另一个属性原样保留。
   * 折叠光标时操作 stored mark（后续输入生效）。
   */
  const setSpanAttr = (attr: "color" | "backgroundColor", value: string | null) => {
    const v = view();
    const markType = spanStyleMark.type(ctx);
    const { state } = v;
    const { from, to, empty } = state.selection;
    if (empty) {
      const base = state.storedMarks ?? state.selection.$from.marks();
      const current = base.find((m) => m.type === markType);
      const merged = { ...(current?.attrs ?? {}), [attr]: value };
      const keep = base.filter((m) => m.type !== markType);
      const next =
        merged.color || merged.backgroundColor ? markType.create(merged) : null;
      v.dispatch(state.tr.setStoredMarks(next ? [next, ...keep] : keep));
      v.focus();
      return;
    }
    // 选区范围：以选区内第一个文本节点的现有属性为基底合并
    // （AllSelection 时 $from.depth 为 0，marks() 取不到，需扫描节点）
    let currentAttrs: Record<string, unknown> | null = null;
    state.doc.nodesBetween(from, Math.max(to, from + 1), (node) => {
      if (node.isText && !currentAttrs) {
        const m = node.marks.find((m) => m.type === markType);
        if (m) currentAttrs = { ...m.attrs };
        return false;
      }
      return true;
    });
    const merged: Record<string, unknown> = { ...(currentAttrs ?? {}), [attr]: value };
    let tr = state.tr.removeMark(from, to, markType);
    if (merged.color || merged.backgroundColor) {
      tr = tr.addMark(from, to, markType.create(merged));
    }
    v.dispatch(tr);
    v.focus();
  };

  const actions: EditorActions = {
    undo: () => call(undoCommand.key),
    redo: () => call(redoCommand.key),
    heading: (level) => call(wrapInHeadingCommand.key, level),
    paragraph: () => call(turnIntoTextCommand.key),
    bumpHeading: (delta) => {
      const level = headingLevelInRange();
      if (level == null) {
        if (delta > 0) call(wrapInHeadingCommand.key, 1);
        return;
      }
      call(wrapInHeadingCommand.key, Math.min(6, Math.max(0, level + delta)));
    },
    bulletList: () => call(wrapInBulletListCommand.key),
    orderedList: () => call(wrapInOrderedListCommand.key),
    blockquote: () => call(wrapInBlockquoteCommand.key),
    codeBlock: () => call(createCodeBlockCommand.key, ""),
    hr: () => call(insertHrCommand.key),
    pickTable: (anchor) => {
      openTablePicker(anchor, (rows, cols) => actions.insertTable(rows, cols));
      return;
    },
    insertTable: (rows, cols) => {
      const clamp = (n: number) => Math.min(20, Math.max(1, Math.round(n) || 1));
      const v = view();
      // 光标在表格内时先退出到表后，避免把新表嵌进单元格产生错乱结构
      const { $from } = v.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "table") {
          v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve($from.after(d)))));
          break;
        }
      }
      call(insertTableCommand.key, { row: clamp(rows), col: clamp(cols) });
      view().focus();
    },
    table: (anchor) => {
      if (anchor) actions.pickTable(anchor);
      // 快捷键无鼠标位置：以编辑器视口中心为锚点
      else {
        const v = view();
        const rect = v.dom.getBoundingClientRect();
        actions.pickTable({
          x: rect.left + rect.width / 2,
          y: rect.top + Math.min(rect.height / 2, 160),
        });
      }
    },
    bold: () => call(toggleStrongCommand.key),
    italic: () => call(toggleEmphasisCommand.key),
    strikethrough: () => call(toggleStrikethroughCommand.key),
    inlineCode: () => call(toggleInlineCodeCommand.key),
    link: () => call(toggleLinkCommand.key, { href: "" }),
    setTextColor: (color) => setSpanAttr("color", color),
    setBackgroundColor: (color) => setSpanAttr("backgroundColor", color),
    clearFormat: () => {
      const v = view();
      const { from, to } = v.state.selection;
      v.dispatch(v.state.tr.removeMark(from, to));
    },
    sinkList: () => call(sinkListItemCommand.key),
    liftList: () => call(liftListItemCommand.key),
    selectAll: () => {
      const v = view();
      v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc)));
      v.focus();
    },
    paste: async () => {
      const text = await readClipboard();
      if (!text) return;
      const v = view();
      try {
        // 走 PM 粘贴管线：milkdown clipboard 插件会把 markdown 源码解析成富文本
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        v.dom.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      } catch {
        v.dispatch(v.state.tr.insertText(text).scrollIntoView());
      }
      v.focus();
    },
    pasteAsPlain: async () => {
      const text = await readClipboard();
      if (!text) return;
      const v = view();
      v.dispatch(v.state.tr.insertText(text).scrollIntoView());
      v.focus();
    },
    placeCaretAt: (x, y) => {
      const v = view();
      const pos = v.posAtCoords({ left: x, top: y });
      if (pos == null) return false;
      const { state } = v;
      const { from, to } = state.selection;
      const isAll = from === 0 && to === state.doc.content.size;
      if (!isAll && pos.pos >= from && pos.pos <= to) return false; // 点在选区内，保留选区
      v.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos.pos))));
      v.focus();
      return true;
    },
    insideCodeMirror: (target) =>
      target instanceof Element && !!target.closest(".cm-editor"),
  };
  return actions;
}
