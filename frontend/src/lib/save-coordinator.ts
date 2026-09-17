type Flusher = () => Promise<void>;

let flusher: Flusher | null = null;
let pendingDirty = false;
const selfSaved = new Map<string, string>();

export function registerFlusher(fn: Flusher | null): void {
  flusher = fn;
}

export async function flushPending(): Promise<void> {
  if (flusher) await flusher();
  if (pendingDirty) throw new Error("文章尚未保存，请先处理保存错误或冲突。");
}

export function setPendingDirty(dirty: boolean): void {
  pendingDirty = dirty;
}

export function hasPendingWork(): boolean {
  return pendingDirty;
}

export function markSelfSaved(rel: string, revision: string): void {
  selfSaved.set(rel, revision);
}

export function isSelfSavedEvent(rel: string, revision: string): boolean {
  return selfSaved.get(rel) === revision;
}
