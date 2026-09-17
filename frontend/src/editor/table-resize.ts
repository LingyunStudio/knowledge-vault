import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory } from "@milkdown/kit/prose/history";
import { MIN_ROW_HEIGHT, MAX_ROW_HEIGHT } from "./table-height";

export function attachTableResize(root: HTMLElement, getView: () => EditorView): () => void {
  const handle = document.createElement("div");
  handle.className = "table-row-resize";
  handle.hidden = true;
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", "调整行高；上下方向键调整，双击或 Home 恢复自动高度");
  handle.title = "拖动调整行高 · 双击恢复自动高度";
  document.body.append(handle);
  let row: HTMLTableRowElement | null = null;
  let drag: { pointer: number; y: number; height: number; value: number; pos: number; doc: EditorView["state"]["doc"] } | null = null;

  const position = () => {
    if (!row?.isConnected) { hide(); return; }
    const rect = row.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    const wrapper = row.closest(".table-wrapper")?.getBoundingClientRect();
    const left = Math.max(rect.left, bounds.left, wrapper?.left ?? 0, 0);
    const right = Math.min(rect.right, bounds.right, wrapper?.right ?? window.innerWidth, window.innerWidth);
    if (rect.bottom < Math.max(0, bounds.top) || rect.bottom > Math.min(window.innerHeight, bounds.bottom) || right <= left) { hide(); return; }
    handle.hidden = false;
    handle.style.left = `${left}px`;
    handle.style.width = `${right - left}px`;
    handle.style.top = `${rect.bottom - 4}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(rect.height)));
  };
  const hide = () => { if (!drag) { handle.hidden = true; row = null; } };
  const rowPosition = (view: EditorView) => {
    if (!row) return null;
    const resolved = view.state.doc.resolve(view.posAtDOM(row, 0));
    for (let depth = resolved.depth; depth > 0; depth--) {
      if (["table_row", "table_header_row"].includes(resolved.node(depth).type.name)) return resolved.before(depth);
    }
    return null;
  };
  const commit = (pos: number, height: number | null) => {
    const view = getView();
    const node = view.state.doc.nodeAt(pos);
    if (!view.editable || !node || !["table_row", "table_header_row"].includes(node.type.name) || node.attrs.rowHeight === height) return;
    view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos, "rowHeight", height));
    view.dispatch(closeHistory(view.state.tr));
  };
  const hover = (event: PointerEvent) => {
    if (drag || event.target === handle) return;
    const target = event.target instanceof Element ? event.target : null;
    const candidate = target?.closest("tr");
    if (!(candidate instanceof HTMLTableRowElement) || !root.contains(candidate) || !getView().editable) { hide(); return; }
    const rect = candidate.getBoundingClientRect();
    if (Math.abs(event.clientY - rect.bottom) <= 6) row = candidate;
    else if (Math.abs(event.clientY - rect.top) <= 6 && candidate.previousElementSibling instanceof HTMLTableRowElement) row = candidate.previousElementSibling;
    else { hide(); return; }
    position();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !row || drag) return;
    const view = getView();
    const pos = rowPosition(view);
    if (pos === null || !view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const height = row.getBoundingClientRect().height;
    drag = { pointer: event.pointerId, y: event.clientY, height, value: height, pos, doc: view.state.doc };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");
    document.body.classList.add("table-row-resizing");
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (getView().state.doc !== drag.doc || !row?.isConnected) { finish(false); return; }
    drag.value = Math.round(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, drag.height + event.clientY - drag.y)));
    // 仅移动指示线，松手后单次事务写回，避免 DOMObserver 在拖动中解析临时样式。
    handle.style.top = `${row.getBoundingClientRect().top + drag.value - 4}px`;
    handle.setAttribute("aria-valuenow", String(drag.value));
    handle.dataset.height = `${drag.value}px`;
  };
  const finish = (save: boolean) => {
    const current = drag;
    if (!current) return;
    drag = null;
    if (handle.hasPointerCapture(current.pointer)) handle.releasePointerCapture(current.pointer);
    handle.classList.remove("active");
    document.body.classList.remove("table-row-resizing");
    delete handle.dataset.height;
    if (save && row?.isConnected && getView().state.doc === current.doc && Math.abs(current.value - current.height) >= 1) commit(current.pos, current.value);
    position();
  };
  const up = (event: PointerEvent) => { if (drag?.pointer === event.pointerId) finish(true); };
  const cancel = () => finish(false);
  const reset = () => {
    if (!row) return;
    const pos = rowPosition(getView());
    if (pos !== null) commit(pos, null);
    position();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && drag) { event.preventDefault(); event.stopPropagation(); cancel(); }
    if (event.target !== handle || drag) return;
    if (event.key === "Home" || event.key === "Enter") { event.preventDefault(); reset(); }
    else if (row && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const pos = rowPosition(getView());
      const delta = (event.key === "ArrowDown" ? 1 : -1) * (event.shiftKey ? 10 : 2);
      if (pos !== null) commit(pos, Math.round(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, row.getBoundingClientRect().height + delta))));
      position();
    }
  };
  const scroll = () => { cancel(); hide(); };
  const observer = new MutationObserver(() => { if (row && !row.isConnected) { cancel(); hide(); } else if (row && !drag) position(); });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  document.addEventListener("pointermove", hover);
  document.addEventListener("keydown", key, true);
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", scroll);
  window.addEventListener("blur", cancel);
  handle.addEventListener("pointerdown", down);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  handle.addEventListener("dblclick", reset);
  return () => {
    cancel();
    observer.disconnect();
    document.removeEventListener("pointermove", hover);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", scroll, true);
    window.removeEventListener("resize", scroll);
    window.removeEventListener("blur", cancel);
    handle.remove();
  };
}
