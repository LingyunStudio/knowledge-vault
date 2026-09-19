import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "./ipc";
import { flushPending } from "./save-coordinator";

export type UpdatePhase = "idle" | "downloading" | "installing";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 自动更新的下载-安装流程（提示条与设置「关于」共用）：
 * 确认后冲刷未保存内容 → 下载（进度经 update-download-progress 事件）→
 * 静默安装，应用自动退出并由安装器打开新版本。
 */
export function useUpdateInstall() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (phase !== "downloading") return;
    const un = listen<{ received: number; total: number }>("update-download-progress", ({ payload }) => {
      setProgress(payload.total > 0 ? Math.min(100, Math.round((payload.received / payload.total) * 100)) : 0);
    });
    return () => { void un.then((f) => f()); };
  }, [phase]);

  const install = async (): Promise<boolean> => {
    if (phase !== "idle") return false;
    setError("");
    try {
      await flushPending();
      setPhase("downloading");
      setProgress(0);
      await ipc.downloadAndInstall();
      setPhase("installing");
      return true;
    } catch (e) {
      setPhase("idle");
      setError(message(e));
      return false;
    }
  };

  return { phase, progress, error, install };
}
