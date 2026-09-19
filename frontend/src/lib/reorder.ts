/**
 * 把 `id` 移动到数组的插入位 `insertAt`（以拖拽悬停时"落在第几张卡片之前/之后"计）。
 * 返回新数组；id 不在数组中或位置没有变化时返回 null（调用方无需提交）。
 */
export function moveItem(ids: string[], id: string, insertAt: number): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  // 移除自身后，原数组中位于 from 之后的插入位整体前移一格
  let to = insertAt > from ? insertAt - 1 : insertAt;
  if (to === from) return null;
  const next = ids.slice();
  next.splice(from, 1);
  if (to < 0 || to > next.length) return null;
  next.splice(to, 0, id);
  return next;
}

/**
 * 计算拖拽悬停在网格第 `hoverIndex` 张卡片上时的插入位：
 * 指针位于卡片前半部落入其之前，否则之后。
 */
export function insertIndexFor(
  hoverIndex: number,
  inFirstHalf: boolean,
): number {
  return inFirstHalf ? hoverIndex : hoverIndex + 1;
}
