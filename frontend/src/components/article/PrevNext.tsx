import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import type { ArticleMetaDto } from "../../lib/types";

export function PrevNext({ rel, secId }: { rel: string; secId: string }) {
  const data = useLibrary((s) => s.data);
  const openArticle = useNav((s) => s.openArticle);
  if (!data) return null;

  const list = data.articles.filter((a) => a.secId === secId);
  const i = list.findIndex((a) => a.rel === rel);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;

  const go = (a: ArticleMetaDto) =>
    openArticle(a.rel, a.secId, a.group);

  return (
    <div className="prev-next">
      {prev ? (
        <a onClick={() => void go(prev)}>
          <div className="cap">← 上一篇</div>
          <div className="t">{prev.title}</div>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a className="next" onClick={() => void go(next)}>
          <div className="cap">下一篇 →</div>
          <div className="t">{next.title}</div>
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}
