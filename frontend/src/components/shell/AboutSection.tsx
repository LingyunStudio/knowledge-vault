import { useEffect, useState } from "react";
import { ipc, type UpdateInfo } from "../../lib/ipc";
import { useUpdateInstall } from "../../lib/update-install";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 设置底部「关于」：展示当前版本，支持手动检查更新；
 * 发现新版本时可在应用内查看 Release Notes 并直接更新。
 * 手动检查不受提示条「忽略此版本」的影响。
 */
export function AboutSection() {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [isLatest, setIsLatest] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const { phase, progress, error: installError, install } = useUpdateInstall();

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(() => {});
  }, []);

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setCheckError("");
    setIsLatest(false);
    try {
      const info = await ipc.checkUpdate();
      setUpdate(info);
      setIsLatest(!info);
    } catch (e) {
      setCheckError(message(e));
    } finally {
      setChecking(false);
    }
  };

  const startInstall = async () => install();

  return <section className="settings-section about-section">
    <p className="about-app">韫玉 · 本地优先的知识库与学习工作台</p>
    <p>当前版本：<code className="about-version">v{version || "…"}</code></p>
    <div className="about-actions">
      <button type="button" disabled={checking || phase !== "idle"} onClick={() => void check()}>
        {checking ? "正在检查…" : "检查更新"}
      </button>
      {update && phase === "idle" && <button type="button" className="update-link" onClick={() => setNotesOpen(true)}>查看 v{update.latest} 更新内容</button>}
      {update && <button type="button" className="action-primary" disabled={phase !== "idle"} onClick={() => void startInstall()}>
        {phase === "downloading" ? `正在下载 ${progress}%` : phase === "installing" ? "正在安装…" : `更新到 v${update.latest}`}
      </button>}
    </div>
    {phase === "downloading" && <p role="status">正在下载安装包… <span className="update-progress"><i style={{ width: `${progress}%` }} /></span> {progress}%</p>}
    {phase === "installing" && <p role="status">安装包已就绪，正在安装新版本，应用将自动重启…</p>}
    {isLatest && <p role="status">当前已是最新版本。</p>}
    {checkError && <p role="alert" className="backup-error">检查更新失败：{checkError}</p>}
    {installError && <p role="alert" className="backup-error">{installError}</p>}
    {notesOpen && update && <ReleaseNotesDialog
      info={update}
      onClose={() => setNotesOpen(false)}
      onInstall={startInstall}
      installLabel={phase === "idle" ? `更新到 v${update.latest}` : undefined}
    />}
  </section>;
}
