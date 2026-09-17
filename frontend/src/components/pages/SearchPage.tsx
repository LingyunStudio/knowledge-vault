import { useMemo, useState } from "react";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { searchArticles, searchTerms, highlightRanges } from "../../lib/search";
import "../../styles/search.css";

const PAGE_SIZE = 20;

/** 合并重叠区间后高亮，不插入 HTML。 */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts: Array<[string, boolean]> = [];
  let i = 0;
  for (const [start, end] of highlightRanges(text, terms)) {
    if (start > i) parts.push([text.slice(i, start), false]);
    parts.push([text.slice(start, end), true]);
    i = end;
  }
  if (i < text.length) parts.push([text.slice(i), false]);
  return <>{parts.map(([part, hit], k) => hit
    ? <mark className="hl" key={k}>{part}</mark>
    : <span key={k}>{part}</span>)}</>;
}

export function SearchPage() {
  const data = useLibrary((s) => s.data);
  const query = useNav((s) => s.query);
  const openArticle = useNav((s) => s.openArticle);
  const openSection = useNav((s) => s.openSection);
  const [secId, setSecId] = useState("");
  const [tag, setTag] = useState("");
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const terms = useMemo(() => searchTerms(query), [query]);
  const hits = useMemo(
    () => data ? searchArticles(data.articles, query, { secId, tag }) : [],
    [data, query, secId, tag],
  );
  // 候选不依赖已筛选结果：零结果时仍可切换筛选，不会丢失当前选项。
  const tags = useMemo(() => [...new Set(
    data?.articles.flatMap((art) => art.tags.map((t) => t.toLowerCase())) ?? [],
  )].sort(), [data]);
  const total = hits.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageKey = JSON.stringify([query, secId, tag]);
  const page = pagination.key === pageKey ? Math.min(pagination.page, pageCount) : 1;
  // 同步重置页码，避免查询改变的一帧仍显示旧页，也避免切回旧查询恢复旧页码。
  if (pagination.key !== pageKey) setPagination({ key: pageKey, page: 1 });
  const start = (page - 1) * PAGE_SIZE;
  const shown = hits.slice(start, start + PAGE_SIZE);
  const changePage = (next: number) => setPagination({ key: pageKey, page: next });

  if (!data) return null;
  if (!terms.length) return <div className="center-note">输入关键词开始搜索</div>;
  const sectionName = (id: string) => data.sections.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="page search-page">
      <div className="search-toolbar">
        <label>
          板块
          <select value={secId} onChange={(e) => setSecId(e.target.value)}>
            <option value="">全部板块</option>
            {data.sections.map((sec) => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
          </select>
        </label>
        <label>
          标签
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部标签</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {(secId || tag) && (
          <button className="search-filter-clear" onClick={() => { setSecId(""); setTag(""); }}>
            清除筛选
          </button>
        )}
      </div>
      <p className="search-hint">空格分隔多个关键词，需全部匹配标题、正文或标签。</p>
      <div className="search-head" role="status">
        “{query.trim()}” · 找到 {total} 个结果{(secId || tag) && "（已筛选）"}
        {total > 0 && ` · 显示 ${start + 1}–${start + shown.length} 条`}
      </div>
      {total === 0 && <div className="search-empty">没有找到相关文章，请尝试其他关键词或清除筛选。</div>}
      {shown.map(({ art, snippet }) => (
        <div key={art.rel} className="search-row">
          <button className="search-row-main" onClick={() => void openArticle(art.rel, art.secId, art.group)}>
            <div className="line1"><span className="t"><Highlighted text={art.title} terms={terms} /></span></div>
            {snippet && <div className="snippet"><Highlighted text={snippet} terms={terms} /></div>}
            {art.tags.length > 0 && (
              <div className="search-tags">
                {art.tags.map((t, i) => <span key={i}><Highlighted text={`#${t}`} terms={terms} /></span>)}
              </div>
            )}
          </button>
          <div className="search-path" aria-label="文章路径">
            <button onClick={() => void openSection(art.secId)} title={`打开板块「${sectionName(art.secId)}」`}>
              {sectionName(art.secId)}
            </button>
            {art.group && <><span>/</span><span>{art.group}</span></>}
            <span>/</span>
            <button title={art.rel} onClick={() => void openArticle(art.rel, art.secId, art.group)}>{art.fileName}</button>
          </div>
        </div>
      ))}
      {total > PAGE_SIZE && (
        <nav className="search-pagination" aria-label="搜索结果分页">
          <button disabled={page === 1} onClick={() => changePage(page - 1)}>上一页</button>
          <span>第 {page} / {pageCount} 页</span>
          <button disabled={page === pageCount} onClick={() => changePage(page + 1)}>下一页</button>
        </nav>
      )}
    </div>
  );
}
