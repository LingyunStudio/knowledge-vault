/**
 * 文章图片拖拽缩放：宽度持久化在图片 src 的 #w= 片段里
 * （如 ![](images/a.png#w=420)），无需扩展 Markdown 语法即可随文件保存。
 */

const WIDTH_RE = /#w=(\d+)/;
const MIN_W = 60;

export function parseImageWidth(src: string): number | null {
  const m = WIDTH_RE.exec(src);
  return m ? Number(m[1]) : null;
}

function withWidth(src: string, width: number): string {
  return `${src.replace(WIDTH_RE, "")}#w=${Math.round(width)}`;
}

/** 扫描编辑器 DOM，把 src 里的 #w= 应用为实际宽度 */
function applyWidths(root: HTMLElement): void {
  for (const img of root.querySelectorAll("img")) {
    if (!(img instanceof HTMLImageElement)) continue;
    const w = parseImageWidth(img.getAttribute("data-kv-src") || img.getAttribute("src") || "");
    if (w && img.style.width !== `${w}px`) {
      img.style.width = `${w}px`;
    }
  }
}

/**
 * 挂载交互：点击图片出现右下角拖拽手柄，拖动实时预览，
 * 松手把新宽度写回 prosemirror 节点的 src（触发 markdownUpdated → 自动保存）。
 */
export function attachImageResize(
  root: HTMLElement,
  getView: () => { posAtDOM: Function; state: { doc: any; tr: any }; dispatch: Function } | null,
): () => void {
  const handle = document.createElement("div");
  handle.className = "img-resize-handle";
  handle.style.display = "none";
  document.body.appendChild(handle);

  let target: HTMLImageElement | null = null;
  let startX = 0;
  let startW = 0;

  const hideHandle = () => {
    handle.style.display = "none";
    target = null;
  };

  const placeHandle = (img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    handle.style.display = "block";
    handle.style.left = `${r.right - 7}px`;
    handle.style.top = `${r.bottom - 7}px`;
  };

  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLImageElement) || !el.closest(".milkdown")) {
      hideHandle();
      return;
    }
    target = el;
    placeHandle(el);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!target) return;
    e.preventDefault();
    startX = e.clientX;
    startW = target.getBoundingClientRect().width;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件下可能失败
    }
    handle.classList.add("active");
  };

  const onPointerMove = (e: PointerEvent) => {
    if (handle.classList.contains("active") && target) {
      const w = Math.max(MIN_W, startW + (e.clientX - startX));
      target.style.width = `${w}px`;
      placeHandle(target);
    }
  };

  const onPointerUp = () => {
    if (!handle.classList.contains("active") || !target) return;
    handle.classList.remove("active");
    const img = target;
    const view = getView();
    const newW = Math.round(img.getBoundingClientRect().width);
    const oldW = parseImageWidth(img.getAttribute("data-kv-src") || img.getAttribute("src") || "");
    hideHandle();
    if (!view || oldW === newW) return;

    const newSrc = withWidth(img.getAttribute("data-kv-src") || img.getAttribute("src") || "", newW);
    // 定位图片对应的 prosemirror 节点并写回 src
    try {
      const pos = view.posAtDOM(img, 0);
      const $pos = view.state.doc.resolve(pos);
      const after = $pos.nodeAfter;
      const before = $pos.nodeBefore;
      if (after?.type.name === "image" && after.attrs.src) {
        view.dispatch(view.state.tr.setNodeAttribute($pos.pos, "src", newSrc));
      } else if (before?.type.name === "image" && before.attrs.src) {
        view.dispatch(
          view.state.tr.setNodeAttribute($pos.pos - before.nodeSize, "src", newSrc),
        );
      }
    } catch (err) {
      console.warn("图片宽度写回失败", err);
    }
  };

  root.addEventListener("click", onClick);
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);

  // 编辑器内容重渲染 / 加载后重新应用宽度
  let raf = 0;
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => applyWidths(root));
  });
  observer.observe(root, { childList: true, subtree: true });
  applyWidths(root);

  return () => {
    observer.disconnect();
    cancelAnimationFrame(raf);
    root.removeEventListener("click", onClick);
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", onPointerUp);
    handle.removeEventListener("pointercancel", onPointerUp);
    handle.remove();
  };
}
