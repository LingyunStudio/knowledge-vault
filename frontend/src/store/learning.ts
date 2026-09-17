import { create } from "zustand";

export type LearningStatus = "unread" | "learning" | "review" | "mastered";
export interface ReadingRecord { favorite: boolean; visited: number; scroll: number; status: LearningStatus }
export interface ReviewCard { id: string; rel: string; question: string; answer: string; due: number; interval: number }
interface VaultLearning { articles: Record<string, ReadingRecord>; cards: ReviewCard[] }
interface LearningState {
  vaults: Record<string, VaultLearning>;
  error: string | null;
  update: (root: string, rel: string, patch: Partial<ReadingRecord>) => void;
  move: (root: string, from: string, to: string) => void;
  addCard: (root: string, rel: string, question: string, answer: string) => void;
  reviewCard: (root: string, id: string, remembered: boolean) => void;
  deleteCard: (root: string, id: string) => void;
}
const KEY = "knowledge-vault-learning-v1";
export const defaultReading: ReadingRecord = { favorite: false, visited: 0, scroll: 0, status: "unread" };
const emptyVault = (): VaultLearning => ({ articles: {}, cards: [] });
const rootKey = (root: string) => root.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
export function nextReview(interval: number, remembered: boolean, now = Date.now()) {
  const days = remembered ? Math.min(90, Math.max(1, interval * 2)) : 0;
  return { interval: days, due: now + (remembered ? days * 86400000 : 600000) };
}
function load(): { vaults: Record<string, VaultLearning>; error: string | null } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { vaults: {}, error: null };
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    for (const vault of Object.values(data) as VaultLearning[]) {
      if (!vault || !vault.articles || !Array.isArray(vault.cards)) throw new Error();
    }
    return { vaults: data, error: null };
  } catch { return { vaults: {}, error: "学习记录读取失败，原始存储未被覆盖。" }; }
}
export const useLearning = create<LearningState>((set, get) => {
  const change = (root: string, fn: (vault: VaultLearning) => VaultLearning) => {
    if (!root) return;
    const key = rootKey(root);
    const vaults = { ...get().vaults, [key]: fn(get().vaults[key] ?? emptyVault()) };
    try { localStorage.setItem(KEY, JSON.stringify(vaults)); set({ vaults, error: null }); }
    catch { set({ vaults, error: "学习记录未能持久保存：存储空间不足或不可用。" }); }
  };
  return {
    ...load(),
    update: (root, rel, patch) => change(root, (v) => ({ ...v, articles: { ...v.articles, [rel]: { ...defaultReading, ...v.articles[rel], ...patch } } })),
    move: (root, from, to) => change(root, (v) => {
      const articles = { ...v.articles };
      if (articles[from]) { articles[to] = articles[from]; delete articles[from]; }
      return { articles, cards: v.cards.map((c) => c.rel === from ? { ...c, rel: to } : c) };
    }),
    addCard: (root, rel, question, answer) => change(root, (v) => ({ ...v, cards: [...v.cards, {
      id: crypto.randomUUID(), rel, question: question.trim(), answer: answer.trim(), due: Date.now(), interval: 0,
    }] })),
    reviewCard: (root, id, remembered) => change(root, (v) => ({ ...v, cards: v.cards.map((c) => c.id === id ? { ...c, ...nextReview(c.interval, remembered) } : c) })),
    deleteCard: (root, id) => change(root, (v) => ({ ...v, cards: v.cards.filter((c) => c.id !== id) })),
  };
});
export function learningFor(root: string, vaults = useLearning.getState().vaults): VaultLearning {
  return vaults[rootKey(root)] ?? emptyVault();
}
