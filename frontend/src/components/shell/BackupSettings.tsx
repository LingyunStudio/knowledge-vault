import { useEffect, useRef, useState } from "react";
import { ipc, type BackupInfo, type StorageSettingsInfo } from "../../lib/ipc";
import { exportLearningBackup, importLearningBackup } from "../../lib/learning-backup";
import { flushPending } from "../../lib/save-coordinator";
import { useLibrary } from "../../store/library";
import { useLearning } from "../../store/learning";
import "../../styles/backup.css";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function BackupSettings() {
  const root = useLibrary((state) => state.root);
  const learningError = useLearning((state) => state.error);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [storage, setStorage] = useState<StorageSettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState<"create" | "restore" | null>(null);
  const lock = useRef(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [restored, setRestored] = useState<{ path: string; error: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setListError("");
    try { setBackups((await ipc.listBackups()).sort((a, b) => b.createdMs - a.createdMs)); }
    catch (e) { setListError(`备份列表读取失败：${message(e)}`); }
    finally { setLoading(false); }
    ipc.storageSettings().then(setStorage).catch(() => {});
  }
  useEffect(() => { void refresh(); }, []);

  async function create() {
    if (lock.current) return;
    lock.current = true;
    setBusy("create"); setError(""); setNotice("");
    const captured = useLibrary.getState().root;
    try {
      if (!captured) throw new Error("当前知识库尚未就绪。");
      if (useLearning.getState().error) throw new Error(useLearning.getState().error!);
      const expectedRoot = captured.path;
      await flushPending();
      const actual = await ipc.libraryRoot();
      if (useLibrary.getState().root !== captured || actual.path !== expectedRoot) {
        throw new Error("当前知识库已改变，请重新确认后备份。");
      }
      const learning = exportLearningBackup(expectedRoot);
      const backup = await ipc.createBackup(expectedRoot, learning);
      setNotice(`手动备份已创建：${new Date(backup.createdMs).toLocaleString()}。`);
      await refresh();
    } catch (e) { setError(`未能创建备份：${message(e)}`); }
    finally { lock.current = false; setBusy(null); }
  }

  async function restore(id: string) {
    if (lock.current || confirm !== id) return;
    lock.current = true;
    setBusy("restore"); setError(""); setNotice(""); setCopied("");
    try {
      const result = await ipc.restoreBackup(id);
      // The directory already exists at this point. Never misreport a localStorage failure
      // as a filesystem restore failure or hide the usable recovered path.
      setRestored({ path: result.path, error: "" });
      try { importLearningBackup(result.path, result.learning); }
      catch (e) { setRestored({ path: result.path, error: message(e) }); }
      setConfirm(null);
    } catch (e) { setError(`副本恢复未完成：${message(e)}`); }
    finally { lock.current = false; setBusy(null); }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("路径已复制。");
    } catch { setCopied("无法访问剪贴板，请选中路径手动复制。"); }
  }

  async function copyPath() {
    if (!restored) return;
    await copyText(restored.path);
  }

  return <div className="backup-settings" aria-busy={busy !== null}>
    <section className="settings-section">
      <h3>数据安全 · 手动备份</h3>
      <p>仅在点击按钮时创建备份；没有自动备份，也不会删除旧备份。</p>
      <ul className="backup-coverage">
        <li>包含当前 knowledge 完整目录：文章、本地 images 图片、.kv 中的历史与回收站等文件，以及当前库的阅读进度、收藏、复习卡和学习日历。</li>
        <li>不包含其他知识库、外部链接或云端图片的内容、AI 对话、API 密钥、AI 服务配置及应用外观/上传设置。</li>
        <li>学习数据必须完整且有效（上限 10 MiB）；损坏或超限会明确拒绝，不会静默丢弃。</li>
      </ul>
      <p className="backup-warning">备份保存在：<code className="backup-path">{storage?.backupsDir ?? "读取中…"}</code>同一磁盘上的备份不能防止磁盘故障；请手动将该文件夹复制到其他磁盘或独立存储。备份保存位置可在“存储位置”设置中更改。</p>
      <p>当前知识库：<code className="backup-path">{root?.path ?? "尚未就绪"}</code></p>
      {learningError && <p role="alert" className="backup-error">{learningError} 请先解决学习存储错误，再创建备份。</p>}
      <button type="button" className="action-primary" disabled={!!busy || !root || !!learningError} onClick={() => void create()}>
        {busy === "create" ? "正在保存并创建备份…" : "立即创建手动备份"}
      </button>
      <p>创建前会等待当前文章保存完成；存在保存冲突或学习记录错误时不创建备份。</p>
    </section>
    {notice && <p role="status">{notice}</p>}
    {copied && <p role="status">{copied}</p>}
    {error && <p role="alert" className="backup-error">{error}</p>}
    {restored && <section className="backup-result" aria-label="恢复结果">
      <h3>文件副本已恢复</h3>
      <p>独立副本目录（未覆盖原库，未切换当前知识库）：</p>
      <code className="backup-path" tabIndex={0}>{restored.path}</code>
      <button type="button" onClick={() => void copyPath()}>复制恢复路径</button>
      {restored.error ? <p role="alert" className="backup-error">文件已恢复，但学习记录未导入：{restored.error} 学习数据仍保留在后端恢复副本的备份清单中，请保留该副本。</p>
        : <p role="status">学习记录已保存到此新目录对应的本地存储，其他库的学习记录未被替换。</p>}
      <p>该副本不会立即启用。下次启动前，如需改用副本，可自行将环境变量 KNOWLEDGE_VAULT_ROOT 指向恢复出的 knowledge 目录；不设置则继续使用当前知识库。</p>
    </section>}
    <section className="settings-section">
      <div className="backup-heading"><h3>已有备份</h3><button type="button" disabled={loading || !!busy} onClick={() => void refresh()}>刷新列表</button></div>
      <p>恢复只在应用数据目录 restored 下生成全新、唯一的 knowledge 副本，不覆盖任何现有数据，也不自动切换知识库。副本旁保留 manifest.json 与 learning.json，供程序读取。</p>
      {listError && <p role="alert" className="backup-error">{listError}</p>}
      {loading ? <p role="status">正在读取备份列表…</p> : !listError && backups.length === 0 && <p>还没有手动备份。</p>}
      <ul className="backup-list">{backups.map((backup) => <li key={backup.id}>
        <strong>{new Date(backup.createdMs).toLocaleString()}</strong>
        <code className="backup-path">{backup.sourceRoot}</code>
        <span>{backup.files.toLocaleString()} 个文件 · {size(backup.bytes)}</span>
        <div className="backup-copy"><code className="backup-path">{backup.path}</code>
          <button type="button" disabled={!!busy} onClick={() => void copyText(backup.path)}>复制备份路径</button>
        </div>
        <span>如需异地保存，可将该备份文件夹手动复制到其他磁盘或设备。</span>
        <button type="button" disabled={!!busy} onClick={() => { setConfirm(backup.id); setError(""); }}>恢复为独立副本</button>
        {confirm === backup.id && <div className="backup-confirm" role="group" aria-label="确认恢复备份">
          <p>确认恢复此备份？将创建一个全新目录，不覆盖原库或任何现有数据，不切换当前知识库。学习记录只会导入新目录；若本地存储不可用，文件副本仍会保留。</p>
          <div className="backup-actions">
            <button type="button" className="action-primary" disabled={!!busy} onClick={() => void restore(backup.id)}>{busy === "restore" ? "正在恢复…" : "确认创建恢复副本"}</button>
            <button type="button" disabled={!!busy} onClick={() => setConfirm(null)}>取消</button>
          </div>
        </div>}
      </li>)}</ul>
    </section>
  </div>;
}
