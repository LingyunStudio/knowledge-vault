import type { ArticleMetaDto } from "./types";

export interface SearchHit {
  art: ArticleMetaDto;
  score: number;
  snippet: string;
  /** snippet 中命中词的起始偏移（按小写匹配） */
  hitAt: number;
}

/** 移植旧版 compute_results：正文子串计数 + 标题命中加权 + 标签加权，取 60 条。 */
export function searchArticles(
  articles: ArticleMetaDto[],
  query: string,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const art of articles) {
    const hay = art.plain.toLowerCase();
    let count = 0;
    let first = -1;
    let i = hay.indexOf(q);
    while (i >= 0) {
      if (first < 0) first = i;
      count++;
      i = hay.indexOf(q, i + q.length);
    }
    if (count === 0 && !art.title.toLowerCase().includes(q)) continue;

    let score = count;
    if (art.title.toLowerCase().includes(q)) score += 100;
    if (art.tags.some((t) => t.toLowerCase().includes(q))) score += 50;
    if (score <= 0) continue;

    const start = Math.max(0, first - 30);
    const end = Math.min(art.plain.length, first + q.length + 50);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < art.plain.length ? "…" : "";
    const snippet = prefix + art.plain.slice(start, end).replace(/\s+/g, " ").trim() + suffix;

    hits.push({ art, score, snippet, hitAt: first - start + prefix.length });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 60);
}
