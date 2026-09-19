import { useEffect, useState } from "react";
import { ipc, type UpdateInfo } from "../../lib/ipc";
import { useUpdateInstall } from "../../lib/update-install";
import { flushPending } from "../../lib/save-coordinator";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";

const DISMISS_KEY = "kv-update-dismissed";

/**
 * 自动更新提示条：启动数秒后检查 GitHub Release（后端在开发构建下恒返回空）。
 * 发现新版本时浮出提示；「查看更新内容」在应用内展示 Release Notes；
 * 确认后下载（带进度）并静默运行安装器，应用自动退出、安装完自动打开新版本。
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const { phase, progress, error, install } = useUpdateInstall();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      ipc.checkUpdate().then((update) => {
        if (!update) return;
        if (localStorage.getItem(DISMISS_KEY) === update.latest) return;
        setInfo(update);
      }).catch(() => {}); // 检测失败不打扰使用
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!info) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, info.latest);
    setInfo(null);
  };

  const startInstall = async () => {
    await flushPending();
    return install();
  };

  return <div className="update-banner" role="status">
    {phase === "installing" ? (
      <span>安装包已就绪，正在安装新版本，应用将自动重启…</span>
    ) : phase === "downloading" ? (
      <>
        <span>正在下载 v{info.latest}…</span>
        <span className="update-progress"><i style={{ width: `${progress}%` }} /></span>
        <span>{progress}%</span>
      </>
    ) : (
      <>
        <span>发现新版本 <strong>v{info.latest}</strong>（当前 v{info.current}）</span>
        <button type="button" className="update-link" onClick={() => setNotesOpen(true)}>查看更新内容</button>
        <button type="button" className="action-primary" onClick={() => void startInstall()}>立即更新</button>
        <button type="button" onClick={dismiss}>忽略此版本</button>
      </>
    )}
    {error && <span className="update-error">{error}</span>}
    {notesOpen && <ReleaseNotesDialog
      info={info}
      onClose={() => setNotesOpen(false)}
      onInstall={() => { setNotesOpen(false); void startInstall(); }}
    />}
  </div>;
}
