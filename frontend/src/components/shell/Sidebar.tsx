import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { composeFile, setTitle } from "../../lib/frontmatter";
import { flushPending } from "../../lib/save-coordinator";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import { useSettings } from "../../store/settings";
import { SettingsDialog } from "./SettingsDialog";

const TWO_DIGIT = (n: number) => String(n).padStart(2, "0");

export function Sidebar() {
  const data = useLibrary((s) => s.data);
  const rescan = useLibrary((s) => s.rescan);
  const { view, query, expanded, toggleExpanded, openArticle, goHome, openLearning, setQuery } =
    useNav();
  const { bumpScale, fontScale } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [newErr, setNewErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<
    { x: number; y: number; rel: string; title: string; confirm: boolean } | null
  >(null);
  const [renaming, setRenaming] = useState<{ rel: string; value: string } | null>(
    null,
  );

  const showErr = (msg: string) => {
    setNewErr(msg);
    window.setTimeout(() => setNewErr(null), 5000);
  };

  // 右键菜单：点击别处 / 右键别处 / Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const createArticle = async (secId: string) => {
    try {
      const { rel } = await ipc.createArticle(secId, "新文章");
      await rescan();
      void openArticle(rel, secId, null);
    } catch (e) {
      showErr(String(e));
    }
  };

  const commitRename = async () => {
    const rn = renaming;
    if (!rn) return;
    setRenaming(null);
    const title = rn.value.trim();
    if (!title) return;
    try {
      await flushPending(); // 若该文章正在编辑且有未落盘修改，先落盘再改名
      const art = await ipc.readArticle(rn.rel);
      const content = composeFile(setTitle(art.fmRaw, title), art.body);
      await ipc.writeArticle(rn.rel, content, art.mtimeMs, art.revision);
      await rescan();
    } catch (e) {
      showErr(String(e));
    }
  };

  const commitDelete = async (rel: string) => {
    try {
      await flushPending();
      await ipc.deleteArticle(rel);
      setMenu(null);
      if (view.name === "article" && view.rel === rel) void goHome();
      await rescan();
    } catch (e) {
      showErr(String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape") {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setQuery]);

  const activeRel = view.name === "article" ? view.rel : null;
  const activeSec = view.name === "section" ? view.id : null;

  return (
    <aside className="sidebar">
      <div className="masthead">
        <nav className="masthead-nav" aria-label="主导航">
          <button type="button" aria-current={!query.trim() && view.name === "home" ? "page" : undefined} onClick={() => void goHome()}>知识库</button>
          <button type="button" aria-current={!query.trim() && view.name === "learning" ? "page" : undefined} onClick={() => void openLearning()}>学习</button>
        </nav>
        <p className="masthead-verse"><span>石韫玉而山辉，水怀珠而川媚。</span></p>
      </div>

      <div className={`search-box${query ? " has-value" : ""}`}>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文章…"
          spellCheck={false}
        />
        <span className="kbd">Ctrl K</span>
      </div>

      <nav className="section-tree scroll-thin">
        {data?.sections.map((sec, i) => {
          const articles = data.articles.filter((a) => a.secId === sec.id);
          // 展开态完全由 expanded 决定：打开文章时 openArticle 会置 true，
          // 用户随后可自由收起（此前被 activeRel 强制顶住导致收不起来）
          const open = !!expanded[sec.id];
          return (
            <div className="tree-section" key={sec.id}>
              <div
                className="tree-section-row"
                style={
                  activeSec === sec.id
                    ? { color: "var(--accent)", background: "var(--accent-soft)" }
                    : undefined
                }
              >
                <button
                  className="tree-arrow"
                  aria-label="展开"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(sec.id);
                  }}
                >
                  <svg width="9" height="9" viewBox="0 0 10 10" className={open ? "open" : ""}>
                    <path d="M2 1 L7 5 L2 9" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </button>
                <span className="num">{TWO_DIGIT(i + 1)}</span>
                <span className="name" onClick={() => toggleExpanded(sec.id)}>
                  {sec.name}
                </span>
                <span className="count">{articles.length}</span>
              </div>

              {open && (
                <div className="tree-section-body">
                  {(() => {
                    let lastGroup: string | null = null;
                    return articles.map((art) => {
                      const showGroupLabel =
                        art.group && art.group !== lastGroup;
                      lastGroup = art.group ?? lastGroup;
                      const renamingThis = renaming?.rel === art.rel;
                      return (
                        <span key={art.rel}>
                          {showGroupLabel && (
                            <div className="tree-group">{art.group}</div>
                          )}
                          {renamingThis ? (
                            <input
                              className="tree-rename"
                              autoFocus
                              value={renaming.value}
                              spellCheck={false}
                              onChange={(e) =>
                                setRenaming({ ...renaming, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitRename();
                                if (e.key === "Escape") setRenaming(null);
                              }}
                              onBlur={() => void commitRename()}
                            />
                          ) : (
                            <button
                              className={`tree-article${activeRel === art.rel ? " active" : ""}`}
                              title={`${art.title}\n右键：重命名 / 删除`}
                              onClick={() =>
                                void openArticle(art.rel, art.secId, art.group)
                              }
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  rel: art.rel,
                                  title: art.title,
                                  confirm: false,
                                });
                              }}
                            >
                              {art.title}
                            </button>
                          )}
                        </span>
                      );
                    });
                  })()}
                  <button
                    className="tree-new"
                    title={`在「${sec.name}」中新建文章`}
                    onClick={() => void createArticle(sec.id)}
                  >
                    ＋ 新建文章
                  </button>
                  {newErr && <div className="tree-new-err">{newErr}</div>}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button title="重新扫描" onClick={() => void rescan()}>
          ⟳
        </button>
        <button title="减小字号" onClick={() => bumpScale(-0.05)}>
          A−
        </button>
        <span className="scale-label">{Math.round(fontScale * 100)}%</span>
        <button title="增大字号" onClick={() => bumpScale(0.05)}>
          A+
        </button>
        <span className="spacer" />
        <button title="设置" aria-label="设置" onClick={() => setSettingsOpen(true)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="m9 3-.6 2.4-2.1 1.2L4 6l-3 5 1.8 1.8v2.4L1 17l3 5 2.3-.6 2.1 1.2L9 25h6l.6-2.4 2.1-1.2 2.3.6 3-5-1.8-1.8v-2.4L23 11l-3-5-2.3.6-2.1-1.2L15 3Z" transform="translate(2 0) scale(.83)" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {menu && (
        <div
          className="ctx-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 140),
            top: Math.min(menu.y, window.innerHeight - 92),
          }}
        >
          <button
            onClick={(e) => {
              // 菜单项点击不能冒泡到 window 的「点别处关闭」监听，否则删除确认永远出不来
              e.stopPropagation();
              setRenaming({ rel: menu.rel, value: menu.title });
              setMenu(null);
            }}
          >
            重命名
          </button>
          <button
            className={menu.confirm ? "danger confirm" : ""}
            onClick={(e) => {
              e.stopPropagation();
              if (menu.confirm) void commitDelete(menu.rel);
              else setMenu({ ...menu, confirm: true });
            }}
          >
            {menu.confirm ? "确认删除？" : "删除"}
          </button>
        </div>
      )}
    </aside>
  );
}
