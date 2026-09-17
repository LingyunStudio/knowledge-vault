import { useMemo } from "react";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { searchArticles } from "../../lib/search";

/** 把文本按查询词切分并高亮。 */
function Highlighted({ text, q }: { text: string; q: string }) {
  const qq = q.trim().toLowerCase();
  if (!qq) return <>{text}</>;
  const low = text.toLowerCase();
  const parts: Array<[string, boolean]> = [];
  let i = 0;
  let at = low.indexOf(qq);
  while (at >= 0) {
    if (at > i) parts.push([text.slice(i, at), false]);
    parts.push([text.slice(at, at + qq.length), true]);
    i = at + qq.length;
    at = low.indexOf(qq, i);
  }
  if (i < text.length) parts.push([text.slice(i), false]);
  return (
    <>
      {parts.map(([t, hit], k) =>
        hit ? <mark className="hl" key={k}>{t}</mark> : <span key={k}>{t}</span>,
      )}
    </>
  );
}

export function SearchPage() {
  const data = useLibrary((s) => s.data);
  const query = useNav((s) => s.query);
  const openArticle = useNav((s) => s.openArticle);
  const q = query.trim();

  const hits = useMemo(
    () => (data ? searchArticles(data.articles, q) : []),
    [data, q],
  );
  const sectionName = (id: string) =>
    data?.sections.find((s) => s.id === id)?.name ?? id;

  if (!data) return null;
  if (!q) return <div className="center-note">输入关键词开始搜索</div>;

  return (
    <div className="page">
      <div className="search-head">
        “{q}” · 找到 {hits.length} 个结果
      </div>
      {hits.length === 0 && <div className="search-empty">没有找到相关文章</div>}
      {hits.map(({ art, snippet }) => (
        <button
          key={art.rel}
          className="search-row"
          onClick={() => void openArticle(art.rel, art.secId, art.group)}
        >
          <div className="line1">
            <span className="sec">{sectionName(art.secId)}</span>
            <span className="t">
              <Highlighted text={art.title} q={q} />
            </span>
          </div>
          <div className="snippet">
            <Highlighted text={snippet} q={q} />
          </div>
        </button>
      ))}
    </div>
  );
}
