import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACCENTS, useSettings, type ColorMode } from "../../store/settings";
import { AiSettings } from "../ai/AiSettings";
import { BackupSettings } from "./BackupSettings";
import { ImageSettings } from "../article/ImageSettings";
import { StorageSettings } from "./StorageSettings";

const TABS = [
  { id: "appearance", label: "外观" },
  { id: "storage", label: "存储位置" },
  { id: "images", label: "图片上传" },
  { id: "ai", label: "AI 设置" },
  { id: "backup", label: "数据安全" },
] as const;
const MODES: { id: ColorMode; label: string; icon: string }[] = [
  { id: "light", label: "浅色", icon: "☀" },
  { id: "dark", label: "深色", icon: "☾" },
  { id: "system", label: "跟随系统", icon: "◐" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("appearance");
  const { mode, accent, setMode, setAccent } = useSettings();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-layout">
        <header className="settings-header">
          <h2 id="settings-title">设置</h2>
          <button className="ai-icon-btn" aria-label="关闭设置" title="关闭" onClick={onClose}>✕</button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          {TABS.map((item, index) => (
            <button
              key={item.id}
              id={`settings-tab-${item.id}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`settings-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(e) => {
                let next = index;
                if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
                else if (e.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = TABS.length - 1;
                else return;
                e.preventDefault();
                setTab(TABS[next].id);
                document.getElementById(`settings-tab-${TABS[next].id}`)?.focus();
              }}
            >{item.label}</button>
          ))}
        </div>
        <div className="settings-body scroll-thin" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
          {tab === "appearance" && <>
            <section className="settings-section">
              <h3>颜色模式</h3>
              <p>跟随系统会随系统的深浅色设置自动切换。</p>
              <div className="settings-modes" role="group" aria-label="颜色模式">
                {MODES.map((item) => <button key={item.id} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
                  <span className="settings-mode-icon" aria-hidden="true">{item.icon}</span>{item.label}
                </button>)}
              </div>
            </section>
            <section className="settings-section">
              <h3>主题色</h3>
              <p>保留纸感底色，调整界面中的强调色。赭红为默认配色。</p>
              <div className="settings-accents" role="group" aria-label="主题色">
                {ACCENTS.map((item) => <button key={item.id} aria-pressed={accent === item.id} onClick={() => setAccent(item.id)}>
                  <span className="settings-swatch" style={{ background: item.light }} aria-hidden="true">{accent === item.id ? "✓" : ""}</span>
                  {item.name}{item.id === "default" && <small>默认</small>}
                </button>)}
              </div>
            </section>
            <div className="settings-preview"><span>预览</span><strong>让阅读更合心意</strong><p>主题色即时生效，设置自动保存。</p></div>
          </>}
          {tab === "images" && <><h3 className="settings-panel-title">图片上传设置</h3><ImageSettings embedded /></>}
          {tab === "ai" && <><h3 className="settings-panel-title">AI 模型设置</h3><AiSettings embedded /></>}
          {tab === "storage" && <><h3 className="settings-panel-title">存储位置</h3><StorageSettings /></>}
          {tab === "backup" && <BackupSettings />}
        </div>
      </div>
    </dialog>, document.body,
  );
}
