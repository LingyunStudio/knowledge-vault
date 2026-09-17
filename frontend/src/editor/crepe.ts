/**
 * Crepe（Milkdown v7 预设）工厂。
 * 阅读与编辑是同一个 contenteditable DOM，永久可编辑、永不切换源码。
 */
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { EditorView } from "@codemirror/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

import { calloutFeature } from "./callout/node";
import { paperCodeTheme } from "./codemirror/paper-theme";
import { editorLanguages } from "./codemirror/languages";
import { attachImageResize } from "./image-resize";
import { tableHeightFeature } from "./table-height";
import { attachTableResize } from "./table-resize";
import { typoraShortcuts } from "./shortcuts";
import { createEditorActions } from "./actions";
import { attachContextMenu } from "./context-menu";
import { spanStyleFeature, hasSpanStyleAttr } from "./span-style/node";
import { openSpanPalette, type SpanStyleKind } from "./span-style/palette";
import { attachPasteInterceptor, attachFileDropCaret, imageUploadFeature } from "./image-paste";

export interface CreateCrepeOptions {
  root: HTMLElement;
  defaultValue: string;
  onMarkdownChange: (markdown: string) => void;
  /** 右键菜单「打开链接」对内链(.md)的导航回调 */
  openInternalLink?: (href: string) => void;
}

export interface CreatedCrepe {
  crepe: Crepe;
  /** 编辑器销毁前调用的清理函数（图片缩放手柄等） */
  dispose: () => void;
}

// —— 工具栏颜色按钮：图标与色板弹层 ——

const TEXT_COLOR_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><text x="12" y="15" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" font-family="inherit">A</text><rect x="5" y="18.5" width="14" height="3" rx="1.2" fill="#b23a26"/></svg>`;

const BG_COLOR_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="8" width="17" height="7.5" rx="1.6" fill="#fde68a"/><path d="M6 12.4h12M6 15h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function openToolbarPalette(ctx: Parameters<typeof hasSpanStyleAttr>[0], kind: SpanStyleKind): void {
  const selector = kind === "color" ? "text-color" : "bg-color";
  const anchor =
    document.querySelector<HTMLElement>(`.milkdown-toolbar [data-toolbar-item="${selector}"]`) ??
    document.querySelector<HTMLElement>(".milkdown-toolbar");
  if (!anchor) return;
  const actions = createEditorActions(ctx);
  openSpanPalette(anchor, kind, (k, value) => {
    if (k === "color") actions.setTextColor(value);
    else actions.setBackgroundColor(value);
  });
}

export async function createCrepe({
  root,
  defaultValue,
  onMarkdownChange,
  openInternalLink,
}: CreateCrepeOptions): Promise<CreatedCrepe> {
  // 复制反馈：记住最近点击的复制按钮，复制成功后短暂显示「已复制」
  let lastCopyButton: HTMLButtonElement | null = null;
  root.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement).closest?.(".copy-button");
      if (btn instanceof HTMLButtonElement) lastCopyButton = btn;
    },
    true,
  );

  const crepe = new Crepe({
    root,
    defaultValue,
    features: {
      [CrepeFeature.AI]: false,
      [CrepeFeature.Latex]: false, // 语料无 LaTeX，顺带不引入 katex
      [CrepeFeature.TopBar]: false,
      [CrepeFeature.ImageBlock]: false, // 语料无图片
    },
    featureConfigs: {
      [CrepeFeature.CodeMirror]: {
        theme: paperCodeTheme,
        languages: editorLanguages,
        extensions: [EditorView.lineWrapping],
        searchPlaceholder: "搜索语言…",
        noResultText: "无匹配语言",
        copyText: "复制",
        onCopy: () => {
          const btn = lastCopyButton;
          if (!btn || btn.dataset.copied) return;
          btn.dataset.copied = "true";
          const original = btn.innerHTML;
          btn.innerHTML = "✓ 已复制";
          window.setTimeout(() => {
            btn.innerHTML = original;
            delete btn.dataset.copied;
          }, 2000);
        },
      },
      [CrepeFeature.Placeholder]: {
        text: "开始输入…",
        mode: "doc",
      },
      [CrepeFeature.Toolbar]: {
        // 默认项标签改中文（悬浮提示与无障碍名）
        boldLabel: "加粗",
        italicLabel: "斜体",
        strikethroughLabel: "删除线",
        codeLabel: "行内代码",
        linkLabel: "链接",
        buildToolbar: (builder) => {
          const colorGroup = builder.addGroup("color", "颜色");
          colorGroup.addItem("text-color", {
            icon: TEXT_COLOR_ICON,
            label: "文字颜色",
            active: (ctx) => hasSpanStyleAttr(ctx, "color"),
            onRun: (ctx) => openToolbarPalette(ctx, "color"),
          });
          colorGroup.addItem("bg-color", {
            icon: BG_COLOR_ICON,
            label: "背景色",
            active: (ctx) => hasSpanStyleAttr(ctx, "backgroundColor"),
            onRun: (ctx) => openToolbarPalette(ctx, "backgroundColor"),
          });
        },
      },
      [CrepeFeature.LinkTooltip]: {
        inputPlaceholder: "粘贴或输入链接",
        editButton: "编辑",
        removeButton: "移除链接",
        confirmButton: "确认",
        onCopyLink: (link) => {
          void navigator.clipboard?.writeText(link);
        },
      },
    },
  });

  crepe.addFeature(calloutFeature);
  crepe.addFeature(spanStyleFeature);
  crepe.addFeature(tableHeightFeature);
  // 图片粘贴/插入：upgit 上传 → 回退本地 images/，并注册相对路径图片显示
  crepe.addFeature(imageUploadFeature);
  // Typora 风格快捷键（Ctrl+1..6 标题、Ctrl+K 链接、Ctrl+Shift+K 代码块等）
  crepe.editor.use(typoraShortcuts);

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      onMarkdownChange(markdown);
    });
  });

  await crepe.create();

  // 图片拖拽缩放：宽度持久化在 src 的 #w= 片段里
  let view: { posAtDOM: Function; state: any; dispatch: Function } | null = null;
  try {
    crepe.editor.action((ctx) => {
      view = ctx.get(editorViewCtx);
    });
  } catch {
    // 编辑器尚未就绪时跳过（缩放手柄将不可用，但不影响渲染）
  }
  const disposeResize = attachImageResize(root, () => view);
  // 表格行高拖拽：与其他挂载一致，编辑器未就绪时静默跳过（仅不可拖拽，不影响渲染）
  let tableView: import("@milkdown/kit/prose/view").EditorView | null = null;
  try {
    crepe.editor.action((ctx) => {
      tableView = ctx.get(editorViewCtx);
    });
  } catch {
    // 编辑器尚未就绪时跳过（行高拖拽不可用，不影响渲染）
  }
  const disposeTableResize = attachTableResize(root, () => tableView!);

  // paste 捕获拦截：剪贴板带图片时剥离 text/html，交由 upload 插件落盘/上传
  let disposePaste: (() => void) | null = null;
  try {
    crepe.editor.action((ctx) => {
      const dom = ctx.get(editorViewCtx).dom;
      disposePaste =
        dom instanceof HTMLElement ? attachPasteInterceptor(dom) : null;
    });
  } catch {
    // 编辑器尚未就绪时跳过
  }

  // 文件拖拽指示：鼠标指向的文字位置显示竖向光标（替代 Crepe 的块间隙横线）
  let disposeDropCaret: (() => void) | null = null;
  try {
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      disposeDropCaret = attachFileDropCaret(() => view);
    });
  } catch {
    // 编辑器尚未就绪时跳过
  }

  // 右键菜单：编辑器就绪后拿 ctx 构建动作层
  let disposeMenu: (() => void) | null = null;
  try {
    crepe.editor.action((ctx) => {
      const actions = createEditorActions(ctx);
      disposeMenu = attachContextMenu(root, actions, { openInternalLink });
    });
  } catch {
    // 编辑器尚未就绪时跳过（右键菜单不可用，不影响渲染）
  }

  // DEV 钩子：全库序列化审计用（生产构建被 tree-shake）
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__crepe = crepe;
  }
  return {
    crepe,
    dispose: () => {
      disposeResize();
      disposeTableResize();
      disposeMenu?.();
      disposePaste?.();
      disposeDropCaret?.();
    },
  };
}
