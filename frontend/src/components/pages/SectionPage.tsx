import { useLibrary, sectionArticles } from "../../store/library";
import { useNav } from "../../store/nav";
import { readingMinutes } from "../../lib/format";
import { SectionLogo } from "../article/SectionLogo";

export function SectionPage({ sectionId }: { sectionId: string }) {
  const data = useLibrary((s) => s.data);
  const openArticle = useNav((s) => s.openArticle);
  if (!data) return null;

  const sec = data.sections.find((s) => s.id === sectionId);
  if (!sec) return <div className="center-note">板块不存在</div>;
  const articles = sectionArticles(data, sectionId);
  const totalMins = articles.reduce(
    (sum, a) => sum + readingMinutes(a.plain),
    0,
  );

  let lastGroup: string | null = null;

  return (
    <div className="page">
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <SectionLogo section={sec} size={56} />
        <div>
          <div className="section-kicker">CONTENTS · {sec.id.toUpperCase()}</div>
          <h1 className="section-title">{sec.name}</h1>
        </div>
      </div>
      <p className="section-desc">{sec.desc}</p>
      <div className="section-meta">
        {articles.length} 篇 · 约 {totalMins} 分钟阅读
      </div>

      <div style={{ marginTop: 24 }}>
        {articles.map((art, i) => {
          const showGroup = art.group && art.group !== lastGroup;
          lastGroup = art.group ?? lastGroup;
          return (
            <span key={art.rel}>
              {showGroup && <div className="group-eyebrow">{art.group}</div>}
              <button
                className="toc-entry"
                onClick={() => void openArticle(art.rel, art.secId, art.group)}
              >
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="body">
                  <div className="t">{art.title}</div>
                  {art.summary && <div className="s">{art.summary}</div>}
                </span>
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
