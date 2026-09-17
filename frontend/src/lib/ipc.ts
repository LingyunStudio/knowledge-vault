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
  deleteArticle: (rel: string) => invoke<void>("delete_article", { rel }),
};

export type { WriteError };

/** 监听 knowledge 目录变更（debouncer 事件或轮询全量信号：空数组）。 */
export function onLibraryChanged(
  fn: (files: ChangedFile[]) => void,
): Promise<UnlistenFn> {
  return listen<ChangedFile[]>("library-changed", (e) => fn(e.payload));
}
