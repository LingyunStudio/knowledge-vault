import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc, type StorageSettingsInfo } from "../../lib/ipc";
import { exportLearningBackup, importLearningBackup } from "../../lib/learning-backup";
import { flushPending } from "../../lib/save-coordinator";
import { useLibrary } from "../../store/library";
import { useNav } from "../../store/nav";
import "../../styles/backup.css";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

const SOURCE_LABELS: Record<string, string> = {
  env: "环境变量 KNOWLEDGE_VAULT_ROOT 指定",
  config: "此设置界面选择",
  "dev-source": "开发模式源码目录",
  ancestor: "程序所在目录",
  cwd: "工作目录",
  "resource-copy": "首次启动从内置资源拷贝",
  resource: "内置资源（只读）",
  fallback: "回退位置",
  uninit: "尚未就绪",
};

type Kind = "knowledge" | "backups";

export function StorageSettings() {
  const root = useLibrary((state) => state.root);
  const [info, setInfo] = useState<StorageSettingsInfo | null>(null);
  const [pending, setPending] = useState<{ kind: Kind; path: string } | null>(null);
  const [migrateBackups, setMigrateBackups] = useState(true);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    ipc.storageSettings().then(setInfo).catch((e) => setError(`存储设置读取失败：${message(e)}`));
  }, []);

  async function pick(kind: Kind) {
    setError(""); setNotice("");
    try {
      const dir = await open({ directory: true, multiple: false, title: kind === "knowledge" ? "选择新的知识库位置" : "选择备份保存位置" });
      if (typeof dir === "string" && dir.trim()) setPending({ kind, path: dir });
    } catch (e) { setError(`无法打开目录选择器：${message(e)}`); }
  }

  async function confirmKnowledge() {
    if (!pending || pending.kind !== "knowledge") return;
    setBusy("knowledge"); setError(""); setNotice("");
    try {
      if (!root) throw new Error("当前知识库尚未就绪。");
      await flushPending();
      // 迁移不经过备份信封，学习记录由前端带到新位置（新位置已有记录时后端拒绝覆盖）。
      const learning = exportLearningBackup(root.path);
      const newRoot = await ipc.setKnowledgeRoot(pending.path);
      let learningNote = "";
      try { importLearningBackup(newRoot.path, learning); }
      catch (e) { learningNote = `学习记录未写入新位置（该位置已有学习记录，未覆盖）：${message(e)}`; }
      await useLibrary.getState().load();
      void useNav.getState().goHome();
      setPending(null);
      setNotice(learningNote
        ? `知识库已迁移并切换到：${newRoot.path}。原目录保留未动。${learningNote}`
        : `知识库已迁移并切换到：${newRoot.path}。原目录保留未动，确认无误后可自行删除；阅读进度、收藏、复习卡与学习日历已带入新位置。`);
      ipc.storageSettings().then(setInfo).catch(() => {});
    } catch (e) {
      setError(`迁移未完成：${message(e)} 当前知识库未改动。若目标目录留有部分复制内容，可手动删除后重试。`);
    } finally { setBusy(null); }
  }

  async function confirmBackups() {
    if (!pending || pending.kind !== "backups") return;
    setBusy("backups"); setError(""); setNotice("");
    try {
      const dir = await ipc.setBackupsDir(pending.path, migrateBackups);
      setPending(null);
      setNotice(migrateBackups
        ? `备份保存位置已更改：${dir}。已有备份已复制到新位置并校验，原位置备份保留未动。`
        : `备份保存位置已更改：${dir}。原位置的备份未被移动，备份列表只显示当前位置的备份。`);
      ipc.storageSettings().then(setInfo).catch(() => {});
    } catch (e) { setError(`备份位置更改未完成：${message(e)} 原位置未改动。`); }
    finally { setBusy(null); }
  }

  const busyText = busy === "knowledge" ? "正在复制并校验…" : "正在保存…";

  return <div className="backup-settings" aria-busy={busy !== null}>
    <section className="settings-section">
      <h3>知识库存储位置</h3>
      <p>当前知识库：<code className="backup-path">{info?.knowledgeRoot ?? root?.path ?? "尚未就绪"}</code>
        {info && <small>（{SOURCE_LABELS[info.knowledgeSource] ?? info.knowledgeSource}）</small>}</p>
      {info && !info.knowledgeWritable && <p role="alert" className="backup-error">当前目录只读，修改不会被保存；建议迁移到可写位置。</p>}
      <p>更改位置时会把当前知识库完整复制到新位置并逐文件校验，成功后自动切换；原目录保留不动。AI 设置、外观等应用数据不受影响。</p>
      <button type="button" className="action-primary" disabled={busy !== null || !info}
        onClick={() => void pick("knowledge")}>选择新的知识库位置…</button>
    </section>
    <section className="settings-section">
      <h3>备份保存位置</h3>
      <p>当前备份目录：<code className="backup-path">{info?.backupsDir ?? "读取中…"}</code>
        {info?.backupsDirCustom && <small>（自定义）</small>}</p>
      <p>手动备份将保存到这里。更改后新位置若留有旧备份不会与之混放；备份列表只显示当前位置的备份。</p>
      <button type="button" disabled={busy !== null || !info} onClick={() => void pick("backups")}>选择备份保存位置…</button>
    </section>
    {error && <p role="alert" className="backup-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <section className="backup-confirm" role="group" aria-label="确认更改存储位置">
      {pending.kind === "knowledge" ? <>
        <h3>迁移知识库到</h3>
        <code className="backup-path" tabIndex={0}>{pending.path}</code>
        <p>迁移会复制文章、图片、.kv 历史与回收站等全部内容并校验，随后切换到新位置；学习记录（阅读进度、收藏、复习卡、学习日历）也会带入。任何一步失败都不会切换。原目录保留不动。</p>
        <div className="backup-actions">
          <button type="button" className="action-primary" disabled={busy !== null} onClick={() => void confirmKnowledge()}>
            {busy === "knowledge" ? busyText : "开始迁移并切换"}</button>
          <button type="button" disabled={busy !== null} onClick={() => setPending(null)}>取消</button>
        </div>
      </> : <>
        <h3>更改备份保存位置到</h3>
        <code className="backup-path" tabIndex={0}>{pending.path}</code>
        <label className="storage-check"><input type="checkbox" checked={migrateBackups}
          onChange={(e) => setMigrateBackups(e.target.checked)} /> 把已有备份复制到新位置（复制并校验，原位置保留）</label>
        <div className="backup-actions">
          <button type="button" className="action-primary" disabled={busy !== null} onClick={() => void confirmBackups()}>
            {busy === "backups" ? busyText : "保存"}</button>
          <button type="button" disabled={busy !== null} onClick={() => setPending(null)}>取消</button>
        </div>
      </>}
    </section>}
  </div>;
}
