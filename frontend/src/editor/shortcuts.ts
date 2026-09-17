/**
 * Typora 风格快捷键（Windows/Linux 习惯，macOS 的 Mod 自动映射为 ⌘）。
 *
 * 与 milkdown 内置快捷键的关系：
 * - 内置已覆盖：Mod-b 加粗 / Mod-i 斜体 / Mod-e 行内代码 /
 *   Mod-Alt-0..6 标题 / Mod-Shift-b 引用 / Mod-Alt-c 代码块 / Mod-Alt-x 删除线
 * - 这里补齐 Typora 习惯：Mod-0..6 标题、Mod-k 链接、Mod-Shift-k 代码块、
 *   Mod-Shift-q 引用、Mod-Shift-[ / ] 列表、Mod-[ / ] 缩进、Alt-Shift-5 删除线、
 *   Mod-\ 清除格式、Mod-Shift-v 粘贴为纯文本、Mod-= / Mod-- 标题升降级
 * - Mod-u：Markdown 无下划线语法，拦截以免浏览器把 <u> 塞进文档
 * - Mod-] / Mod-[：表格内由 gfm 的单元格导航优先（先注册），列表场景才生效
 */
import { $shortcut } from "@milkdown/kit/utils";
import { createEditorActions } from "./actions";

export const typoraShortcuts = $shortcut((ctx) => {
  const actions = createEditorActions(ctx);
  const bind = (run: () => void) => () => {
    run();
    return true;
  };

  return {
    "Mod-1": bind(() => actions.heading(1)),
    "Mod-2": bind(() => actions.heading(2)),
    "Mod-3": bind(() => actions.heading(3)),
    "Mod-4": bind(() => actions.heading(4)),
    "Mod-5": bind(() => actions.heading(5)),
    "Mod-6": bind(() => actions.heading(6)),
    "Mod-0": bind(() => actions.paragraph()),
    "Mod-=": bind(() => actions.bumpHeading(1)),
    "Mod--": bind(() => actions.bumpHeading(-1)),

    "Mod-k": bind(() => actions.link()),
    "Alt-Shift-5": bind(() => actions.strikethrough()),
    "Mod-Shift-k": bind(() => actions.codeBlock()),
    "Mod-Shift-q": bind(() => actions.blockquote()),
    "Mod-Shift-[": bind(() => actions.orderedList()),
    "Mod-Shift-]": bind(() => actions.bulletList()),
    "Mod-Shift-7": bind(() => actions.orderedList()),
    "Mod-Shift-8": bind(() => actions.bulletList()),
    "Mod-[": bind(() => actions.liftList()),
    "Mod-]": bind(() => actions.sinkList()),
    "Mod-t": bind(() => actions.table()),
    "Mod-\\": bind(() => actions.clearFormat()),
    "Mod-Shift-v": bind(() => actions.pasteAsPlain()),

    // Markdown 没有下划线：吞掉按键，防止浏览器向文档注入 <u>
    "Mod-u": () => true,
  };
});
