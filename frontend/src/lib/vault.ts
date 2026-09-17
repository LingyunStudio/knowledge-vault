import { invoke } from "@tauri-apps/api/core";
import type { ArticleFileDto } from "./types";
export interface RecoveryEntry { id: string; rel: string; createdMs: number; bytes: number; reason?: string }
export interface ArticleLink { sourceRel: string; destination: string; targetRel: string | null; kind: string; exists: boolean | null }
export interface Metadata { title: string; summary: string; tags: string[]; order: number }
export const vault = {
  trash: () => invoke<RecoveryEntry[]>("list_trash"),
  restoreTrash: (id: string) => invoke<ArticleFileDto>("restore_trash", { id }),
  history: (rel: string) => invoke<RecoveryEntry[]>("list_article_history", { rel }),
  readHistory: (id: string) => invoke<{ entry: RecoveryEntry; content: string }>("read_article_history", { id }),
  restoreHistory: (id: string, expectedRevision: string) => invoke<ArticleFileDto>("restore_article_history", { id, expectedRevision }),
  metadata: (rel: string, metadata: Metadata, expectedRevision: string) => invoke<ArticleFileDto>("update_article_metadata", { rel, metadata, expectedRevision }),
  move: (rel: string, targetRel: string, expectedRevision: string) => invoke<{ article: ArticleFileDto; updatedRels: string[] }>("move_article", { rel, targetRel, expectedRevision }),
  links: () => invoke<{ links: ArticleLink[]; warnings: string[] }>("list_article_links"),
};
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const e = error as { kind?: string; message?: string };
  return e?.kind === "conflict" ? "文章已发生变化，操作已取消。请关闭面板、处理冲突后重试。" : e?.message ?? "操作失败，请重试。";
}
