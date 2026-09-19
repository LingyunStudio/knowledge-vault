import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ArticleFileDto,
  ChangedFile,
  LibraryDto,
  LogoDto,
  RootInfo,
  WriteError,
  WriteOk,
} from "./types";

export const ipc = {
  libraryRoot: () => invoke<RootInfo>("library_root"),
  scanLibrary: () => invoke<LibraryDto>("scan_library"),
  readArticle: (rel: string) =>
    invoke<ArticleFileDto>("read_article", { rel }),
  writeArticle: (rel: string, content: string, expectedMtimeMs: number | null, expectedRevision?: string | null) =>
    invoke<WriteOk>("write_article", {
      rel,
      content,
      expectedMtimeMs,
      expectedRevision,
    }),
  readLogo: (section: string) =>
    invoke<LogoDto | null>("read_logo", { section }),
  readCover: (section: string) =>
    invoke<LogoDto | null>("read_cover", { section }),
  /** 粘贴/插入的图片落到板块 images/ 目录，返回库内相对路径 */
  savePasteImage: (secId: string, fileName: string, dataBase64: string) =>
    invoke<{ rel: string }>("save_paste_image", { secId, fileName, dataBase64 }),
  /** 运行 upgit 等上传命令，返回解析到的图片链接 */
  runUploadCommand: (command: string, fileExt: string, dataBase64: string) =>
    invoke<{ url: string }>("run_upload_command", { command, fileExt, dataBase64 }),
  /** 读取库内相对路径图片，返回 data URL（编辑器内显示用） */
  readImage: (rel: string) => invoke<LogoDto | null>("read_image", { rel }),
  createArticle: (secId: string, title: string) =>
    invoke<{ rel: string }>("create_article", { secId, title }),
  createSection: (
    name: string,
    desc?: string | null,
    cover?: { ext: string; dataBase64: string } | null,
  ) =>
    invoke<{ id: string }>("create_section", {
      name,
      desc: desc ?? null,
      cover: cover ?? null,
    }),
  /** 更新板块显示信息（名称/描述/封面横幅/图标），板块目录名不变。 */
  updateSection: (
    section: string,
    update: {
      name: string;
      desc: string;
      cover?: { ext: string; dataBase64: string } | null;
      removeCover?: boolean;
      logo?: { ext: string; dataBase64: string } | null;
      removeLogo?: boolean;
    },
  ) =>
    invoke<void>("update_section", {
      section,
      update: {
        name: update.name,
        desc: update.desc,
        cover: update.cover ?? null,
        removeCover: update.removeCover ?? false,
        logo: update.logo ?? null,
        removeLogo: update.removeLogo ?? false,
      },
    }),
  /** 按传入顺序持久化板块排序（写入各板块 _section.md 的 order 字段）。 */
  reorderSections: (ids: string[]) => invoke<void>("reorder_sections", { ids }),
  deleteArticle: (rel: string) => invoke<void>("delete_article", { rel }),
  /** 创建手动备份：完整 knowledge/.kv/images + 学习记录，存放在应用数据目录 backups/ 下。 */
  createBackup: (expectedRoot: string, learning: unknown) =>
    invoke<BackupInfo>("create_backup", { expectedRoot, learning }),
  /** 列出全部手动备份（不读取内容）。 */
  listBackups: () => invoke<BackupInfo[]>("list_backups", {}),
  /** 恢复到 app data/restored/ 下的全新独立目录，绝不改动当前库与既有数据。 */
  restoreBackup: (id: string) => invoke<RestoreInfo>("restore_backup", { id }),
  /** 读取存储位置设置：知识库根目录 + 备份保存目录。 */
  storageSettings: () => invoke<StorageSettingsInfo>("storage_settings"),
  /** 迁移知识库到新位置：完整复制并逐文件校验后切换；原目录保留不动。 */
  setKnowledgeRoot: (path: string) => invoke<RootInfo>("set_knowledge_root", { path }),
  /** 更改备份保存目录；migrateExisting = 把已有备份复制到新位置（原位置保留）。 */
  setBackupsDir: (path: string, migrateExisting: boolean) =>
    invoke<string>("set_backups_dir", { path, migrateExisting }),
  /** 检查 GitHub 最新 release；有更新返回信息，否则返回 null（开发构建恒为 null）。 */
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  /** 下载更新并静默运行安装器；完成后应用自动退出，安装结束自动打开新版本。 */
  downloadAndInstall: () => invoke<void>("download_and_install"),
  /** 供应商 API Key 存入系统凭据管理器（Windows 凭据管理器）；空串 = 清除。 */
  credentialSet: (id: string, apiKey: string) =>
    invoke<void>("credential_set", { id, apiKey }),
  /** 读取系统凭据库中的 Key；无条目返回 null。 */
  credentialGet: (id: string) => invoke<string | null>("credential_get", { id }),
  /** 从系统凭据库删除 Key；条目不存在视为成功。 */
  credentialDelete: (id: string) => invoke<void>("credential_delete", { id }),
};

export type { WriteError };

/** 监听 knowledge 目录变更（debouncer 事件或轮询全量信号：空数组）。 */
export function onLibraryChanged(
  fn: (files: ChangedFile[]) => void,
): Promise<UnlistenFn> {
  return listen<ChangedFile[]>("library-changed", (e) => fn(e.payload));
}

/** 手动备份信息（后端 create_backup / list_backups 返回）。path 为备份文件夹绝对路径。 */
export interface BackupInfo {
  id: string;
  createdMs: number;
  sourceRoot: string;
  files: number;
  bytes: number;
  path: string;
}

/** 恢复结果：独立的 restored 副本目录 + 该源库的学习记录负载。 */
export interface RestoreInfo {
  path: string;
  learning: unknown;
}

/** 存储位置设置（后端 storage_settings 返回）。 */
export interface StorageSettingsInfo {
  knowledgeRoot: string;
  knowledgeSource: string;
  knowledgeWritable: boolean;
  backupsDir: string;
  backupsDirCustom: boolean;
}

/** 可用更新信息（后端 check_update 返回）。 */
export interface UpdateInfo {
  current: string;
  latest: string;
  releaseUrl: string;
  assetName: string;
}