/** 中文为主文本的阅读时长估算（约 400 字/分钟，代码/英文混合从简）。 */
export function readingMinutes(text: string): number {
  const mins = Math.round(text.replace(/\s+/g, "").length / 400);
  return Math.max(1, mins);
}

export function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
