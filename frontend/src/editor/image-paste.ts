/**
 * 图片粘贴/插入链路：
 * 1. 覆盖 milkdown upload 插件的 uploader——启用 upgit 时先走上传命令
 *    （Typora 习惯：图片写临时文件，路径作为最后一个参数追加），失败回退本地；
 * 2. 本地落盘到板块 `images/` 目录，markdown 里使用文章相对路径（Typora 兼容）；
 * 3. 相对路径图片通过 node view 解析为 data URL 显示，序列化保持原路径。
 */
import { attachPasteInterceptor as attachImageClipboard } from "./image-clipboard";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, nodeViewCtx, SchemaReady } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { uploadConfig, type UploadOptions } from "@milkdown/kit/plugin/upload";
import type { Schema } from "@milkdown/kit/prose/model";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { dirOf } from "../lib/links";
import { parseImageWidth } from "./image-resize";
import { ipc } from "../lib/ipc";
import { useNav } from "../store/nav";
import { useSettings } from "../store/settings";

/** 相对路径图片 → data URL 的显示缓存（键为库内绝对相对路径） */
const dataUrlCache = new Map<string, string>();
// 错误只用于编辑器显示，不写入 Markdown；键使用库内路径，避免不同文章串图。
const uploadErrors = new Map<string, string>();

function toast(message: string, sticky = false): void {
  const el = document.createElement("div");
  el.className = sticky ? "kv-toast error" : "kv-toast";
  el.textContent = message;
  if (sticky) {
    el.setAttribute("role", "alert");
    el.title = "点击关闭";
    el.addEventListener("click", () => el.remove(), { once: true });
  } else {
    window.setTimeout(() => el.classList.add("out"), 2200);
    window.setTimeout(() => el.remove(), 2600);
  }
  document.body.appendChild(el);
}

/** 把文章相对路径（images/x.png、../images/x.png）解析为库内绝对相对路径 */
function resolveImageRel(currentRel: string, src: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("/")) return null;
  const base = dirOf(currentRel).split("/");
  for (const seg of src.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  const rel = base.join("/").replace(/#.*$/, "");
  return rel.includes(".") ? rel : null;
}

async function fileToBase64(file: File): Promise<{ ext: string; base64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
  const m = /^data:image\/(png|jpeg|webp|gif|svg\+xml|bmp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("仅支持 PNG / JPG / WebP / GIF 图片");
  const ext = m[1].toLowerCase() === "svg+xml" ? "svg" : m[1].toLowerCase();
  return { ext: ext === "jpeg" ? "jpg" : ext, base64: m[2] };
}

/** 单张图片的落盘/上传决策，返回要写入文档的 src */
async function resolveSrc(file: File): Promise<string> {
  const article = useNav.getState().view;
  if (article.name !== "article") throw new Error("请先打开文章");
  const currentRel = article.rel;
  const secId = currentRel.split("/")[0];
  const settings = useSettings.getState();
  const { ext, base64 } = await fileToBase64(file);
  const { rel } = await ipc.savePasteImage(secId, `image.${ext}`, base64);
  const depth = dirOf(currentRel).split("/").length - 1;
  const localSrc = `${"../".repeat(depth)}images/${rel.split("/").pop()}`;
  if (!settings.imageUploadEnabled) return localSrc;
  toast("图片上传中…");
  try {
    if (!settings.imageUploadCommand.trim()) throw new Error("上传命令为空");
    const { url } = await ipc.runUploadCommand(settings.imageUploadCommand, ext, base64);
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("上传未返回有效链接");
    return url;
  } catch (error) {
    uploadErrors.set(rel, `图片上传失败，已保存到本地。原因：${String(error).replace(/^Error:\s*/, "")}`);
    return localSrc;
  }
}

/** 相对路径图片的显示：解析为 data URL；序列化不受影响（attrs.src 保持原样）。 */
class RelativeImageView {
  dom: HTMLSpanElement;
  private image: HTMLImageElement;
  private error: HTMLSpanElement;
  private current: string | null = null;

  constructor(node: ProseNode) {
    this.dom = document.createElement("span");
    this.dom.className = "kv-image-view";
    this.dom.contentEditable = "false";
    this.image = document.createElement("img");
    this.error = document.createElement("span");
    this.error.className = "kv-image-error";
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;
    this.dom.append(this.image, this.error);
    this.render(node);
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== "image") return false;
    this.render(node);
    return true;
  }

  private render(node: ProseNode): void {
    const src = String(node.attrs.src ?? "");
    this.current = src;
    this.image.alt = String(node.attrs.alt ?? "");
    this.image.setAttribute("data-kv-src", src);
    // #w= 宽度片段在这里直接应用（缩放手柄读写的是 img 的 data-kv-src）
    const width = parseImageWidth(src);
    this.image.style.width = width ? `${width}px` : "";
    // 相对路径图片在保存或上传失败时，在图片下方显示红色错误（键为库内路径）
    const rel = this.relativePath(src);
    const uploadError = rel ? uploadErrors.get(rel) : undefined;
    this.error.textContent = uploadError ?? "";
    this.error.hidden = !uploadError;
    if (/^(https?:|data:|blob:)/i.test(src)) {
      this.image.src = src;
      return;
    }
    if (!rel) {
      this.image.removeAttribute("src");
      return;
    }
    const cached = dataUrlCache.get(rel);
    if (cached) {
      this.image.src = cached;
      return;
    }
    void ipc.readImage(rel).then((r) => {
      if (!r?.dataUrl) return;
      dataUrlCache.set(rel, r.dataUrl);
      if (this.current === src) this.image.src = r.dataUrl;
    });
  }

  /** 把文章相对路径（images/x.png、../images/x.png）解析为库内绝对相对路径 */
  private relativePath(src: string): string | null {
    if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("/")) return null;
    const view = useNav.getState().view;
    if (view.name !== "article") return null;
    return resolveImageRel(view.rel, src);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {}
}

/** 相对路径图片的 node view 注册（等 schema 就绪后按类型名挂载）。 */
const imageViewPlugin: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady);
  const name = imageSchema.type(ctx).name;
  // milkdown 的 nodeViewCtx 实际存 [类型名, NodeViewConstructor] 对，
  // 运行时用 Object.fromEntries 展开（声明类型偏宽松，此处局部断言）
  ctx.update(nodeViewCtx, (ps) => {
    // PM 的 nodeView 是工厂函数：调用后返回实例
    const entry = [name, (node: ProseNode) => new RelativeImageView(node)] as unknown as (typeof ps)[number];
    return [...ps, entry];
  });
  return () => {
    ctx.update(nodeViewCtx, (ps) =>
      ps.filter((x) => (x as unknown as [string, unknown])[0] !== name),
    );
  };
};

/** 编辑器 feature：覆盖 uploader + 注册相对路径图片的 node view。 */
export function imageUploadFeature(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(uploadConfig.key, (prev: UploadOptions) => ({
      ...prev,
      // 剪贴板带 text/html 时（AI 客户端复制的图片常是 base64 的 HTML）也走上传器
      enableHtmlFileUploader: true,
      getInsertPos: (event, ctx, defaultPos) => {
        if (!(event instanceof DragEvent)) return defaultPos;
        return ctx.get(editorViewCtx).posAtCoords(fileDropPoint(event))?.pos ?? defaultPos;
      },
      uploader: async (files: FileList, schema: Schema) => {
        const nodes = [];
        for (let i = 0; i < files.length; i++) {
          const file = files.item(i);
          if (!file || !file.type.includes("image")) continue;
          try {
            const src = await resolveSrc(file);
            const node = schema.nodes.image?.createAndFill({
              src,
              alt: file.name.replace(/\.[^.]+$/, ""),
            });
            if (node) nodes.push(node);
          } catch (e) {
            toast(`图片插入失败：${String(e).replace(/^Error:\s*/, "")}`, true);
          }
        }
        return nodes;
      },
    }));
  }).use(imageViewPlugin);
}

export function attachPasteInterceptor(dom: HTMLElement): () => void {
  return attachImageClipboard(dom, resolveSrc, (message) => toast(message, true));
}

// 外部文件的系统拖拽缩略图不能通过目标页的 setDragImage 改动。
// 预览与上传共用偏移坐标，避免显示光标和实际插入位置分离。
export function fileDropPoint(event: Pick<DragEvent, "clientX" | "clientY">) {
  return { left: Math.max(0, event.clientX - 96), top: event.clientY };
}

/** 文件拖拽光标与上传器使用同一落点，替代 Crepe 的块间横线。 */
export function attachFileDropCaret(
  getView: () => {
    posAtCoords: (o: { left: number; top: number }) => { pos: number } | null;
    coordsAtPos: (pos: number) => { left: number; top: number; bottom: number };
  } | null,
): () => void {
  const caret = document.createElement("div");
  caret.className = "kv-drop-caret";
  caret.style.display = "none";
  document.body.appendChild(caret);
  let hideTimer = 0;

  const hide = () => {
    window.clearTimeout(hideTimer);
    caret.style.display = "none";
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
    // 允许 drop，并抢在 Crepe 块边界横线（同元素上更早注册的监听）之前短路
    e.preventDefault();
    e.stopImmediatePropagation();
    const view = getView();
    const pos = view?.posAtCoords(fileDropPoint(e))?.pos;
    if (pos == null || !view) {
      hide();
      return;
    }
    const coords = view.coordsAtPos(pos);
    caret.style.display = "block";
    caret.style.left = `${coords.left - 1}px`;
    caret.style.top = `${coords.top}px`;
    caret.style.height = `${Math.max(coords.bottom - coords.top, 18)}px`;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 80);
  };

  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("drop", hide, true);
  document.addEventListener("dragend", hide, true);
  return () => {
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("drop", hide, true);
    document.removeEventListener("dragend", hide, true);
    window.clearTimeout(hideTimer);
    caret.remove();
  };
}
