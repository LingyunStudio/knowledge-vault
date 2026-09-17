/**
 * 保存协调器：ArticlePage 注册当前文章的立即落盘函数，
 * 切换文章、关窗前由导航动作/窗口钩子统一 flush。
 * 同时记录本端刚写入的 (rel, mtime)，用于忽略 watcher 的回声事件。
 */

type Flusher = () => Promise<void>;

let flusher: Flusher | null = null;
const selfSaved = new Map<string, number>(); // rel -> 写入完成时间戳(ms)
const SELF_WINDOW = 3000;

export function registerFlusher(fn: Flusher | null): void {
  flusher = fn;
}

export async function flushPending(): Promise<void> {
  if (flusher) await flusher();
}

/** 当前文章是否有未落盘的修改（由 ArticlePage 在编辑/保存时标记）。 */
let pendingDirty = false;

export function setPendingDirty(dirty: boolean): void {
  pendingDirty = dirty;
}

/** 关窗时判断能否直接走原生关闭。 */
export function hasPendingWork(): boolean {
  return flusher !== null && pendingDirty;
}

export function markSelfSaved(rel: string): void {
  selfSaved.set(rel, Date.now());
}

export function isSelfSavedEvent(rel: string): boolean {
  const t = selfSaved.get(rel);
  if (!t) return false;
  if (Date.now() - t > SELF_WINDOW) {
    selfSaved.delete(rel);
    return false;
  }
  return true;
}
