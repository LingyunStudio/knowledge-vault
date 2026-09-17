import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { LibraryDto, RootInfo } from "../lib/types";

interface LibraryState {
  root: RootInfo | null;
  data: LibraryDto | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  rescan: () => Promise<void>;
}

export const useLibrary = create<LibraryState>((set) => ({
  root: null,
  data: null,
  loading: true,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [root, data] = await Promise.all([
        ipc.libraryRoot(),
        ipc.scanLibrary(),
      ]);
      set({ root, data, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  rescan: async () => {
    try {
      const data = await ipc.scanLibrary();
      set({ data, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));

/** 板块下的文章（扫描结果已按 group→order→title 排序）。 */
export function sectionArticles(
  data: LibraryDto,
  secId: string,
): import("../lib/types").ArticleMetaDto[] {
  return data.articles.filter((a) => a.secId === secId);
}

export function findArticle(
  data: LibraryDto | null,
  rel: string,
): import("../lib/types").ArticleMetaDto | undefined {
  return data?.articles.find((a) => a.rel === rel);
}
