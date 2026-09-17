import { create } from "zustand";
import { flushPending } from "../lib/save-coordinator";

export type View =
  | { name: "home" }
  | { name: "section"; id: string }
  | { name: "article"; rel: string };
interface Location { view: View; query: string; scroll: number }
interface NavState {
  view: View;
  query: string;
  expanded: Record<string, boolean>;
  past: Location[];
  future: Location[];
  error: string | null;
  restoreScroll: number | null;
  openArticle: (rel: string, secId?: string, group?: string | null) => Promise<boolean>;
  openSection: (id: string) => Promise<boolean>;
  goHome: () => Promise<boolean>;
  setQuery: (q: string) => Promise<boolean>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  clearError: () => void;
  toggleExpanded: (key: string) => void;
  setExpanded: (key: string, v: boolean) => void;
}
let navigationVersion = 0;
const scrollTop = () => document.getElementById("content-scroll")?.scrollTop ?? 0;

export const useNav = create<NavState>((set, get) => {
  const go = async (view: View, query = "", travel?: "back" | "forward") => {
    const version = ++navigationVersion;
    const current = get();
    const location = { view: current.view, query: current.query, scroll: scrollTop() };
    try {
      await flushPending();
      if (version !== navigationVersion) return false;
      if (travel) {
        const from = travel === "back" ? current.past : current.future;
        const destination = from.at(-1);
        if (!destination) return false;
        set({
          view: destination.view, query: destination.query, error: null, restoreScroll: destination.scroll,
          past: travel === "back" ? current.past.slice(0, -1) : [...current.past, location].slice(-100),
          future: travel === "forward" ? current.future.slice(0, -1) : [...current.future, location].slice(-100),
        });
      } else {
        const same = JSON.stringify(view) === JSON.stringify(current.view) && query === current.query;
        set({ view, query, error: null, restoreScroll: same ? location.scroll : null,
          past: same || (query && current.query) ? current.past : [...current.past, location].slice(-100), future: [] });
      }
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "保存未完成，已保留当前文章。" });
      return false;
    }
  };
  return {
    view: { name: "home" }, query: "", expanded: {}, past: [], future: [], error: null, restoreScroll: null,
    openArticle: async (rel, secId, group) => {
      const ok = await go({ name: "article", rel });
      if (ok) set((s) => ({ expanded: { ...s.expanded, ...(secId ? { [secId]: true } : {}),
        ...(secId && group ? { [`${secId}/${group}`]: true } : {}) } }));
      return ok;
    },
    openSection: (id) => go({ name: "section", id }),
    goHome: () => go({ name: "home" }),
    setQuery: (query) => go(get().view, query),
    back: () => go(get().view, get().query, "back"),
    forward: () => go(get().view, get().query, "forward"),
    clearError: () => set({ error: null }),
    toggleExpanded: (key) => set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),
    setExpanded: (key, v) => set((s) => ({ expanded: { ...s.expanded, [key]: v } })),
  };
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__nav = useNav;
}
