import { useState } from "react";
import { ipc } from "../../lib/ipc";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { SectionLogo } from "../article/SectionLogo";
import { SectionCover } from "../article/SectionCover";

const COVER_MAX_MB = 12;

interface PickedCover {
  ext: string;
  dataBase64: string;
  preview: string;
  name: string;
}

export function HomePage() {
  const data = useLibrary((s) => s.data);
  const rescan = useLibrary((s) => s.rescan);
  const openSection = useNav((s) => s.openSection);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cover, setCover] = useState<PickedCover | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!data) return null;

  // 空板块也展示（新建后没有文章同样可见）
  const sections = data.sections;

  const onCoverFile = (file: File | null) => {
    setErr(null);
    if (!file) {
      setCover(null);
      return;
    }
    const m = /^image\/(png|jpeg|webp|gif)$/.exec(file.type);
    if (!m) {
      setErr("封面仅支持 PNG / JPG / WebP / GIF");
      return;
    }
    if (file.size > COVER_MAX_MB * 1024 * 1024) {
      setErr(`封面图片过大（超过 ${COVER_MAX_MB}MB）`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const ext = file.type === "image/jpeg" ? "jpg" : m[1];
      setCover({ ext, dataBase64: base64, preview: dataUrl, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setAdding(false);
    setName("");
    setDesc("");
    setCover(null);
    setErr(null);
  };

  const submit = async () => {
    const name_ = name.trim();
    if (!name_) return;
    try {
      const { id } = await ipc.createSection(
        name_,
        desc.trim() || null,
        cover ? { ext: cover.ext, dataBase64: cover.dataBase64 } : null,
      );
      resetForm();
      await rescan();
      openSection(id);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="page page-wide">
      <header className="home-hero">
        <div className="vol">VOL. 01 · KNOWLEDGE VAULT</div>
        <h1>知识库</h1>
        <div className="sub">
          所学皆有踪 · {sections.length} 个篇章 · {data.articles.length} 篇札记
        </div>
      </header>

      <div className="section-grid">
        {sections.map((sec) => {
          const count = data.articles.filter((a) => a.secId === sec.id).length;
          const meta = (
            <span className="meta">
              <div>
                <span className="name">{sec.name}</span>
                <span className="count">{count} 篇</span>
              </div>
              <div className="desc">{sec.desc}</div>
            </span>
          );
          // 没有封面的板块保持原有卡片结构；仅有封面的板块在顶部加横幅
          return sec.hasCover ? (
            <button
              key={sec.id}
              className="section-card with-cover"
              onClick={() => openSection(sec.id)}
            >
              <SectionCover sectionId={sec.id} />
              <span className="meta-row">
                <SectionLogo section={sec} />
                {meta}
              </span>
            </button>
          ) : (
            <button key={sec.id} className="section-card" onClick={() => openSection(sec.id)}>
              <SectionLogo section={sec} />
              {meta}
            </button>
          );
        })}

        {adding ? (
          <div className="section-card new adding">
            <input
              autoFocus
              value={name}
              placeholder="板块名称，如「Rust 进阶」"
              spellCheck={false}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void submit();
                if (e.key === "Escape") resetForm();
              }}
            />
            <input
              className="desc-input"
              value={desc}
              placeholder="一句话描述（可选）"
              spellCheck={false}
              onChange={(e) => {
                setDesc(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void submit();
                if (e.key === "Escape") resetForm();
              }}
            />
            <label
              className={cover ? "cover-pick filled" : "cover-pick"}
              title={cover ? cover.name : "选择封面图片（可选）"}
            >
              {cover ? (
                <>
                  <img src={cover.preview} alt="" />
                  <span
                    className="cover-clear"
                    title="移除封面"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCover(null);
                    }}
                  >
                    ×
                  </span>
                </>
              ) : (
                <span className="cover-hint">🖼 封面图片（可选）</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => onCoverFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="new-actions">
              <button onClick={() => name.trim() && void submit()}>创建</button>
              <button onClick={resetForm}>取消</button>
            </div>
            {err && <div className="new-err">{err}</div>}
          </div>
        ) : (
          <div
            className="section-card new"
            title="创建新的板块"
            onClick={() => setAdding(true)}
          >
            <span className="plus">＋</span>
            <span className="new-label">新建板块</span>
          </div>
        )}
      </div>
    </div>
  );
}
