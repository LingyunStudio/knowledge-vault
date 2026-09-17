import { useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { useLibrary, sectionArticles } from "../../store/library";
import { useNav } from "../../store/nav";
import { readingMinutes } from "../../lib/format";
import { SectionLogo } from "../article/SectionLogo";

export function SectionPage({ sectionId }: { sectionId: string }) {
  const data = useLibrary((s) => s.data);
  const rescan = useLibrary((s) => s.rescan);
  const openArticle = useNav((s) => s.openArticle);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const createLock = useRef(false);
  if (!data) return null;

  const sec = data.sections.find((s) => s.id === sectionId);
  if (!sec) return <div className="center-note">板块不存在</div>;

  // 与 Sidebar 同款流程：默认标题建文 → 重扫 → 打开编辑器
  const createNew = async () => {
    if (createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setCreateErr(null);
    try {
      const { rel } = await ipc.createArticle(sec.id, "新文章");
      await rescan();
      await openArticle(rel, sec.id, null);
    } catch (e) {
      setCreateErr(String(e));
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };

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
        {articles.length === 0 && (
          <div>
            <p className="section-desc">此板块还没有文章</p>
            <button
              className="toc-entry"
              disabled={creating}
              onClick={() => void createNew()}
            >
              {creating ? "正在创建…" : "＋ 新建文章"}
            </button>
            {createErr && <div className="tree-new-err">{createErr}</div>}
          </div>
        )}
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
