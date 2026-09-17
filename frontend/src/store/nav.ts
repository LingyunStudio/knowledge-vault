import { create } from "zustand";
import { flushPending } from "../lib/save-coordinator";

export type View =
  | { name: "home" }
  | { name: "section"; id: string }
  | { name: "article"; rel: string };

interface NavState {
  view: View;
  query: string;
  /** 侧栏展开态：键为板块 id 或 `板块/分组` */
  expanded: Record<string, boolean>;
  openArticle: (rel: string, secId?: string, group?: string | null) => Promise<void>;
  openSection: (id: string) => void;
  goHome: () => Promise<void>;
  setQuery: (q: string) => void;
  toggleExpanded: (key: string) => void;
  setExpanded: (key: string, v: boolean) => void;
}

export const useNav = create<NavState>((set) => ({
  view: { name: "home" },
  query: "",
  expanded: {},

  openArticle: async (rel, secId, group) => {
    await flushPending();
    set((s) => ({
      view: { name: "article", rel },
      query: "",
      expanded: {
        ...s.expanded,
        ...(secId ? { [secId]: true } : {}),
        ...(secId && group ? { [`${secId}/${group}`]: true } : {}),
      },
    }));
  },

  openSection: (id) => set({ view: { name: "section", id }, query: "" }),

  goHome: async () => {
    await flushPending();
    set({ view: { name: "home" }, query: "" });
  },

  setQuery: (query) => set({ query }),

  toggleExpanded: (key) =>
    set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),

  setExpanded: (key, v) =>
    set((s) => ({ expanded: { ...s.expanded, [key]: v } })),
}));

// DEV 钩子：自动化审计/测试驱动导航用
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__nav = useNav;
}
