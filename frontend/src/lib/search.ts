import type { ArticleMetaDto } from "./types";

export interface SearchHit {
  art: ArticleMetaDto;
  score: number;
  snippet: string;
  /** snippet 中首个命中词的起始偏移；仅标题/标签命中时为 -1。 */
  hitAt: number;
}

export interface SearchFilters {
  secId?: string;
  tag?: string;
}

/** 空白分词，不区分大小写；多个词须全部命中，可分布在不同字段。 */
export function searchTerms(query: string): string[] {
  return [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
}

/** 返回合并后的命中区间，避免重叠词重复显示文本；查询按字面值匹配。 */
export function highlightRanges(text: string, terms: string[]): Array<[number, number]> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) continue;
    let at = lower.indexOf(term);
    while (at >= 0) {
      ranges.push([at, at + term.length]);
      at = lower.indexOf(term, at + 1);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** 正文次数 + 标题/标签加权；返回全部结果，由页面分页，避免总数被截断。 */
export function searchArticles(
  articles: ArticleMetaDto[],
  query: string,
  filters: SearchFilters = {},
): SearchHit[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  const tag = filters.tag?.toLowerCase();

  for (const art of articles) {
    if (filters.secId && art.secId !== filters.secId) continue;
    const tags = art.tags.map((t) => t.toLowerCase());
    if (tag && !tags.includes(tag)) continue;
    // 先归一化空白再计算偏移，确保摘要与高亮使用相同坐标。
    const plain = art.plain.replace(/\s+/g, " ").trim();
    const hay = plain.toLowerCase();
    const title = art.title.toLowerCase();
    let score = 0;
    let first = -1;
    let firstLength = 0;
    let matchesAll = true;

    for (const term of terms) {
      const titleMatch = title.includes(term);
      const tagMatch = tags.some((t) => t.includes(term));
      let count = 0;
      let at = hay.indexOf(term);
      if (at >= 0 && (first < 0 || at < first)) {
        first = at;
        firstLength = term.length;
      }
      while (at >= 0) {
        count++;
        at = hay.indexOf(term, at + term.length);
      }
      if (!count && !titleMatch && !tagMatch) {
        matchesAll = false;
        break;
      }
      score += count + (titleMatch ? 100 : 0) + (tagMatch ? 50 : 0);
    }
    if (!matchesAll) continue;

    const start = first < 0 ? 0 : Math.max(0, first - 30);
    const end = first < 0 ? 100 : first + firstLength + 50;
    const prefix = start > 0 ? "…" : "";
    const snippet = prefix + plain.slice(start, end) + (end < plain.length ? "…" : "");
    hits.push({ art, score, snippet, hitAt: first < 0 ? -1 : first - start + prefix.length });
  }

  // 稳定排序：同分保留扫描顺序，分页期间不会随机跳动。
  return hits.sort((a, b) => b.score - a.score);
}
