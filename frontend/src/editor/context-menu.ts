/**
 * 编辑器右键菜单：纯 DOM 实现（与 image-resize 同风格，不进 React 树）。
 * 参照 Typora 的分区：剪贴板 / 段落 / 格式，外加链接的上下文动作。
 * 内嵌 CodeMirror 代码块内只保留全局动作，避免对代码块内容误操作。
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { isExternal } from "../lib/links";
import type { EditorActions } from "./actions";

export interface ContextMenuOptions {
  /** 内链（.md）打开回调，由宿主提供导航逻辑 */
  openInternalLink?: (href: string) => void;
}

interface MenuItem {
  label: string;
  kbd?: string;
  /** 接收菜单弹出坐标（表格选择器以菜单位置为锚点） */
  run: (anchor: { x: number; y: number }) => void;
  /** 长标签项独占整行 */
  wide?: boolean;
}

const sep = null;

const buildGroups = (a: EditorActions): Array<Array<MenuItem> | typeof sep> => [
  [
    { label: "撤销", kbd: "Ctrl+Z", run: () => a.undo() },
    { label: "重做", kbd: "Ctrl+Y", run: () => a.redo() },
    { label: "剪切", kbd: "Ctrl+X", run: () => document.execCommand("cut") },
    { label: "复制", kbd: "Ctrl+C", run: () => document.execCommand("copy") },
    { label: "粘贴", kbd: "Ctrl+V", run: () => a.paste() },
    { label: "粘贴为纯文本", kbd: "Ctrl+Shift+V", wide: true, run: () => a.pasteAsPlain() },
    { label: "全选", kbd: "Ctrl+A", run: () => a.selectAll() },
  ],
  sep,
  [
    { label: "正文", kbd: "Ctrl+0", run: () => a.paragraph() },
    { label: "标题 1", kbd: "Ctrl+1", run: () => a.heading(1) },
    { label: "标题 2", kbd: "Ctrl+2", run: () => a.heading(2) },
    { label: "标题 3", kbd: "Ctrl+3", run: () => a.heading(3) },
    { label: "标题 4", kbd: "Ctrl+4", run: () => a.heading(4) },
    { label: "标题 5", kbd: "Ctrl+5", run: () => a.heading(5) },
    { label: "标题 6", kbd: "Ctrl+6", run: () => a.heading(6) },
    { label: "引用", kbd: "Ctrl+Shift+Q", run: () => a.blockquote() },
    { label: "代码块", kbd: "Ctrl+Shift+K", run: () => a.codeBlock() },
    { label: "无序列表", kbd: "Ctrl+Shift+8", run: () => a.bulletList() },
    { label: "有序列表", kbd: "Ctrl+Shift+7", run: () => a.orderedList() },
    { label: "表格", kbd: "Ctrl+T", run: (anchor) => a.table(anchor) },
    { label: "分隔线", run: () => a.hr() },
  ],
  sep,
  [
    { label: "粗体", kbd: "Ctrl+B", run: () => a.bold() },
    { label: "斜体", kbd: "Ctrl+I", run: () => a.italic() },
    { label: "删除线", kbd: "Alt+Shift+5", run: () => a.strikethrough() },
    { label: "行内代码", kbd: "Ctrl+E", run: () => a.inlineCode() },
    { label: "链接", kbd: "Ctrl+K", run: () => a.link() },
    { label: "清除格式", kbd: "Ctrl+\\", run: () => a.clearFormat() },
  ],
];

export function attachContextMenu(
  root: HTMLElement,
  actions: EditorActions,
  options: ContextMenuOptions = {},
): () => void {
  const menu = document.createElement("div");
  menu.className = "kv-ctx";
  menu.style.display = "none";
  document.body.appendChild(menu);

  const h = (tag: string, cls?: string, text?: string) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };

  const addItem = (item: MenuItem) => {
    const btn = h("button", item.wide ? "kv-ctx-item kv-ctx-wide" : "kv-ctx-item");
    const label = h("span", "kv-ctx-label", item.label);
    btn.appendChild(label);
    if (item.kbd) btn.appendChild(h("kbd", undefined, item.kbd));
    btn.addEventListener("pointerdown", (e) => e.preventDefault()); // 不抢编辑器焦点
    btn.addEventListener("click", () => {
      const rect = btn.getBoundingClientRect();
      close();
      item.run({ x: rect.left + rect.width / 2, y: rect.bottom });
    });
    return btn;
  };

  const cmGroup: MenuItem[] = [
    { label: "撤销", kbd: "Ctrl+Z", run: () => actions.undo() },
    { label: "重做", kbd: "Ctrl+Y", run: () => actions.redo() },
    { label: "剪切", kbd: "Ctrl+X", run: () => document.execCommand("cut") },
    { label: "复制", kbd: "Ctrl+C", run: () => document.execCommand("copy") },
    { label: "全选", kbd: "Ctrl+A", run: () => document.execCommand("selectAll") },
  ];

  const render = (inCM: boolean, link: { href: string; external: boolean } | null) => {
    menu.replaceChildren();
    // 内嵌 CodeMirror 代码块内：只保留全局动作，
    // 且不提供依赖 PM 粘贴管线的粘贴项（代码块有自己的粘贴处理）
    if (inCM) {
      const grid = h("div", "kv-ctx-group");
      cmGroup.forEach((item) => grid.appendChild(addItem(item)));
      menu.appendChild(grid);
      return;
    }
    if (link) {
      const row = h("div", "kv-ctx-group kv-ctx-single");
      row.appendChild(
        addItem({
          label: link.external ? "在浏览器打开链接" : "打开链接",
          run: () => {
            if (link.external) void openUrl(link.href);
            else options.openInternalLink?.(link.href);
          },
        }),
      );
      row.appendChild(
        addItem({
          label: "复制链接地址",
          run: () => void navigator.clipboard?.writeText(link.href),
        }),
      );
      menu.appendChild(row);
      menu.appendChild(h("div", "kv-ctx-sep"));
    }
    for (const group of buildGroups(actions)) {
      if (group === sep) {
        menu.appendChild(h("div", "kv-ctx-sep"));
        continue;
      }
      const grid = h("div", "kv-ctx-group");
      group.forEach((item) => grid.appendChild(addItem(item)));
      menu.appendChild(grid);
    }
  };

  const close = () => {
    menu.style.display = "none";
  };

  const openAt = (x: number, y: number) => {
    menu.style.display = "block";
    // 先挂载再量尺寸，避免溢出视口
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - margin)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - margin)}px`;
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const inCM = actions.insideCodeMirror(target);
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href") ?? null;
    // href 可能为空串（Ctrl+K 新建的待编辑链接），仅以是否存在 <a> 判定
    const link = anchor && href != null ? { href, external: isExternal(href) } : null;
    if (!inCM) actions.placeCaretAt(e.clientX, e.clientY);
    render(inCM, link);
    openAt(e.clientX, e.clientY);
  };

  const onDocPointerDown = (e: PointerEvent) => {
    if (menu.style.display === "none") return;
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const onScrollOrResize = () => close();

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
  window.addEventListener("blur", onScrollOrResize);
  root.addEventListener("contextmenu", onContextMenu);

  return () => {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    window.removeEventListener("blur", onScrollOrResize);
    root.removeEventListener("contextmenu", onContextMenu);
    menu.remove();
  };
}
