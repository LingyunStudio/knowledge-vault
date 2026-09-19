import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc, type UpdateInfo } from "../../lib/ipc";
import { flushPending } from "../../lib/save-coordinator";

const DISMISS_KEY = "kv-update-dismissed";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 自动更新提示条：启动数秒后检查 GitHub Release（后端在开发构建下恒返回空）。
 * 发现新版本时浮出提示；确认后下载（带进度）并静默运行安装器，
 * 应用自动退出，安装完成由安装器打开新版本。
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "installing">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

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

  useEffect(() => {
    if (phase !== "downloading") return;
    const un = listen<{ received: number; total: number }>("update-download-progress", ({ payload }) => {
      setProgress(payload.total > 0 ? Math.min(100, Math.round((payload.received / payload.total) * 100)) : 0);
    });
    return () => { void un.then((f) => f()); };
  }, [phase]);

  if (!info) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, info.latest);
    setInfo(null);
  };

  const install = async () => {
    if (phase !== "idle") return;
    setError("");
    try {
      await flushPending();
      setPhase("downloading");
      setProgress(0);
      await ipc.downloadAndInstall();
      setPhase("installing");
    } catch (e) {
      setPhase("idle");
      setError(message(e));
    }
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
        <button type="button" className="update-link" onClick={() => openUrl(info.releaseUrl)}>查看发布页</button>
        <button type="button" className="action-primary" onClick={() => void install()}>立即更新</button>
        <button type="button" onClick={dismiss}>忽略此版本</button>
      </>
    )}
    {error && <span className="update-error">{error}</span>}
  </div>;
}
