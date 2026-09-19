import { useState } from "react";
import { ipc } from "../../lib/ipc";
import { moveItem, insertIndexFor } from "../../lib/reorder";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import type { SectionDto } from "../../lib/types";
import { SectionLogo } from "../article/SectionLogo";
import { SectionCover, invalidateCoverCache } from "../article/SectionCover";
import { ContextMenu } from "../shell/ContextMenu";
import { SectionEditDialog } from "./SectionEditDialog";

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
  const writable = useLibrary((s) => s.root?.writable ?? false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cover, setCover] = useState<PickedCover | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 右键菜单与编辑对话框
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<SectionDto | null>(null);

  // 拖拽排序：dragId 为拖动中的板块，dropIndex 为插入位（第几张卡片之前）
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

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

  const openMenu = (e: React.MouseEvent, id: string) => {
    if (!writable) return;
    e.preventDefault();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };

  const removeCover = async (id: string) => {
    const sec = data.sections.find((s) => s.id === id);
    if (!sec) return;
    try {
      await ipc.updateSection(id, { name: sec.name, desc: sec.desc, removeCover: true });
      invalidateCoverCache(id);
      await rescan();
    } catch (e) {
      useNav.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const commitReorder = (id: string, insertAt: number) => {
    setDragId(null);
    setDropIndex(null);
    const next = moveItem(sections.map((s) => s.id), id, insertAt);
    if (!next) return;
    // 乐观更新：先按新顺序渲染，落盘成功后由 rescan 确认；失败时 rescan 以磁盘为准回滚
    const byId = new Map(sections.map((s) => [s.id, s] as const));
    useLibrary.setState({
      data: { ...data, sections: next.map((i) => byId.get(i)!).filter(Boolean) },
    });
    ipc.reorderSections(next)
      .then(() => rescan())
      .catch((e) => {
        useNav.setState({ error: e instanceof Error ? e.message : String(e) });
        void rescan();
      });
  };

  // 卡片通用属性：打开板块 + 右键菜单 + 拖拽排序
  const cardProps = (sec: SectionDto, index: number) => ({
    onClick: () => void openSection(sec.id),
    draggable: writable,
    onContextMenu: (e: React.MouseEvent) => openMenu(e, sec.id),
    onDragStart: (e: React.DragEvent) => {
      if (!writable) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sec.id);
      setDragId(sec.id);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropIndex(null);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!writable || !dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      setDropIndex(insertIndexFor(index, e.clientX < rect.left + rect.width / 2));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      commitReorder(sec.id, dropIndex ?? index);
    },
    className: `section-card${sec.hasCover ? " with-cover" : ""}${dragId === sec.id ? " dragging" : ""}${dropIndex === index ? " drop-target drop-before" : dropIndex === index + 1 ? " drop-target drop-after" : ""}`,
  });

  const menuSection = menu ? sections.find((s) => s.id === menu.id) : null;

  return (
    <div className="page page-wide">
      <header className="home-hero">
        <div className="vol">韫玉 · 藏知于内，温故日新</div>
        <h1>知识库</h1>
        <div className="sub">
          所学皆有踪 · {sections.length} 个篇章 · {data.articles.length} 篇札记
        </div>
      </header>

      <div
        className="section-grid"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
        }}
      >
        {sections.map((sec, index) => {
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
            <button key={sec.id} {...cardProps(sec, index)}>
              <SectionCover sectionId={sec.id} />
              <span className="meta-row">
                <SectionLogo section={sec} />
                {meta}
              </span>
            </button>
          ) : (
            <button key={sec.id} {...cardProps(sec, index)}>
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

      {menu && menuSection && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "编辑名称 / 描述 / 封面…",
              onSelect: () => setEditing(menuSection),
            },
            ...(menuSection.hasCover
              ? [{ label: "移除封面", onSelect: () => void removeCover(menuSection.id) }]
              : []),
          ]}
        />
      )}
      {editing && (
        <SectionEditDialog
          section={editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void rescan();
          }}
        />
      )}
    </div>
  );
}
