/** 后端 DTO 类型，字段与 src-tauri/src/library.rs 保持一致（camelCase）。 */

export interface SectionDto {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  brand: string | null;
  order: number;
  /** 是否有封面图（cover.{png,jpg,jpeg,webp,gif}） */
  hasCover: boolean;
}

export interface ArticleMetaDto {
  rel: string;
  fileName: string;
  group: string | null;
  secId: string;
  title: string;
  summary: string;
  order: number;
  tags: string[];
  mtimeMs: number;
  plain: string;
}

export interface LibraryDto {
  sections: SectionDto[];
  articles: ArticleMetaDto[];
}

export interface ArticleFileDto {
  rel: string;
  fmRaw: string | null;
  title: string;
  summary: string;
  order: number;
  tags: string[];
  body: string;
  mtimeMs: number;
  revision: string;
}

export interface RootInfo {
  path: string;
  source: string;
  writable: boolean;
}

export interface LogoDto {
  dataUrl: string;
}

export interface WriteOk {
  mtimeMs: number;
  revision: string;
}

/** 对应 Rust enum WriteError（serde internally tagged）。 */
export type WriteError =
  | { kind: "invalidRel" }
  | { kind: "conflict"; disk: ArticleFileDto | null }
  | { kind: "io"; message?: string };

export interface ChangedFile {
  rel: string;
  kind: string;
}
