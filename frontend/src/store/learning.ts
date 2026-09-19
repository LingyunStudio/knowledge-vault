import { create } from "zustand";
import type { CardDraft } from "../lib/ai-authoring";

export type LearningStatus = "unread" | "learning" | "review" | "mastered";
export interface ReadingRecord { favorite: boolean; visited: number; scroll: number; status: LearningStatus }
export interface ReviewCard {
  id: string; rel: string; question: string; answer: string; due: number; interval: number;
  type?: "choice" | "short"; options?: string[]; correctIndex?: number;
}
export interface LearningDay { read: string[]; created: number; reviewed: number }
export interface VaultLearning { articles: Record<string, ReadingRecord>; cards: ReviewCard[]; activity?: Record<string, LearningDay> }
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function recordActivity(vault: VaultLearning, kind: "read" | "created" | "reviewed", rel?: string) {
  const key = localDateKey();
  const day = vault.activity?.[key] ?? { read: [], created: 0, reviewed: 0 };
  const next = kind === "read"
    ? { ...day, read: Array.from(new Set([...day.read, rel!])) }
    : { ...day, [kind]: day[kind] + 1 };
  return { ...vault, activity: { ...vault.activity, [key]: next } };
}
interface LearningState {
  vaults: Record<string, VaultLearning>;
  error: string | null;
  update: (root: string, rel: string, patch: Partial<ReadingRecord>) => void;
  move: (root: string, from: string, to: string) => void;
  addCard: (root: string, rel: string, question: string, answer: string) => void;
  addCards: (root: string, rel: string, cards: CardDraft[]) => number;
  reviewCard: (root: string, id: string, remembered: boolean) => void;
  deleteCard: (root: string, id: string) => void;
  importBackup: (root: string, payload: unknown, validate: (value: unknown) => VaultLearning) => void;
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
      if (vault.activity !== undefined) {
        if (!vault.activity || typeof vault.activity !== "object" || Array.isArray(vault.activity)) throw new Error();
        for (const [date, day] of Object.entries(vault.activity)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || !Array.isArray(day.read) || !day.read.every((rel) => typeof rel === "string")
            || !Number.isSafeInteger(day.created) || day.created < 0 || !Number.isSafeInteger(day.reviewed) || day.reviewed < 0) throw new Error();
        }
      }
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
    // Validation is injected to avoid a runtime dependency cycle with learning-backup.
    importBackup: (root, payload, validate) => {
      const state = get();
      if (state.error) throw new Error(state.error);
      if (!root.trim()) throw new Error("恢复目录为空。");
      const key = rootKey(root);
      const snapshot = validate(payload);
      const raw = localStorage.getItem(KEY);
      let persisted: Record<string, VaultLearning> = {};
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          for (const [existingRoot, value] of Object.entries(parsed)) {
            if (!existingRoot.trim()) throw new Error();
            validate(value);
          }
          persisted = parsed as Record<string, VaultLearning>;
        } catch { throw new Error("现有学习存储损坏，未覆盖任何记录。"); }
      }
      for (const vaults of [persisted, state.vaults]) {
        if (Object.keys(vaults).some((existing) => rootKey(existing) === key)) {
          throw new Error("恢复目录已有学习记录，拒绝覆盖。");
        }
        for (const value of Object.values(vaults)) validate(value);
      }
      // Preserve fresh on-disk records from other windows as well as unrelated in-memory vaults.
      const next = { ...state.vaults, ...persisted, [key]: snapshot };
      localStorage.setItem(KEY, JSON.stringify(next));
      set({ vaults: next, error: null });
    },
    update: (root, rel, patch) => change(root, (v) => {
      const next = { ...v, articles: { ...v.articles, [rel]: { ...defaultReading, ...v.articles[rel], ...patch } } };
      return patch.visited && patch.visited > 0 ? recordActivity(next, "read", rel) : next;
    }),
    move: (root, from, to) => change(root, (v) => {
      const articles = { ...v.articles };
      if (articles[from]) { articles[to] = articles[from]; delete articles[from]; }
      const activity = Object.fromEntries(Object.entries(v.activity ?? {}).map(([date, day]) => [date,
        { ...day, read: Array.from(new Set(day.read.map((rel) => rel === from ? to : rel))) }]));
      return { ...v, articles, activity, cards: v.cards.map((c) => c.rel === from ? { ...c, rel: to } : c) };
    }),
    addCard: (root, rel, question, answer) => change(root, (v) => recordActivity({ ...v, cards: [...v.cards, {
      id: crypto.randomUUID(), rel, question: question.trim(), answer: answer.trim(), due: Date.now(), interval: 0,
    }] }, "created")),
    addCards: (root, rel, cards) => {
      const { vaults, error } = get();
      if (error) throw new Error(error);
      if (!root || !rel) throw new Error("缺少知识库或来源文章。");
      if (!Array.isArray(cards) || cards.length > 12) throw new Error("单批最多 12 张卡片。");
      if (cards.length === 0) return 0;
      const key = rootKey(root);
      const signature = (c: Pick<ReviewCard, "rel" | "type" | "question" | "answer" | "options" | "correctIndex">) =>
        JSON.stringify([c.rel, c.type ?? "short", c.question.trim(), c.answer.trim(),
          c.type === "choice" ? c.options?.map((option) => option.trim()) : undefined,
          c.type === "choice" ? c.correctIndex : undefined]);
      const seen = new Set((vaults[key]?.cards ?? []).map(signature));
      const fresh: ReviewCard[] = [];
      for (const card of cards) {
        const question = typeof card?.question === "string" ? card.question.trim() : "";
        const answer = typeof card?.answer === "string" ? card.answer.trim() : "";
        if (question.length > 1000 || answer.length > 6000) throw new Error("复习卡内容过长。");
        if (card?.type !== "choice" && (card?.options !== undefined || card?.correctIndex !== undefined)) {
          throw new Error("简答卡片不能包含选择题字段。");
        }
        let base: ReviewCard = { id: crypto.randomUUID(), rel, question, answer, due: Date.now(), interval: 0 };
        if (card?.type === "choice") {
          if (!question || !answer) throw new Error("选择题问题和答案解析必须非空。");
          if (!Array.isArray(card.options) || card.options.length !== 4 ||
              Array.from(card.options).some((option) => typeof option !== "string" || !option.trim() || option.length > 500) ||
              new Set(card.options.map((option) => option.trim())).size !== 4 ||
              typeof card.correctIndex !== "number" || !Number.isInteger(card.correctIndex) ||
              card.correctIndex < 0 || card.correctIndex > 3) throw new Error("选择题卡片缺少有效的选项或正确答案索引。");
          base = { ...base, type: "choice", options: card.options.map((option) => option.trim()), correctIndex: card.correctIndex };
        } else if (card?.type === "short") {
          base = { ...base, type: "short" };
        } else if (card?.type !== undefined) {
          throw new Error("卡片类型无效。");
        }
        const sig = signature(base);
        if (!question || !answer || seen.has(sig)) continue;
        seen.add(sig);
        fresh.push(base);
      }
      // 单批最多 12 张（UI 解析层会先行拒绝 >12 的输入）；去重后为空则不产生任何写入。
      if (fresh.length === 0 || fresh.length > 12) return 0;
      const base = vaults[key] ?? emptyVault();
      let vault: VaultLearning = { ...base, cards: [...base.cards, ...fresh] };
      for (let i = 0; i < fresh.length; i++) vault = recordActivity(vault, "created");
      const next = { ...vaults, [key]: vault };
      // 有意不走 change()：持久化失败必须向上抛出，且失败前不调用 set()，状态零改动以便安全重试。
      localStorage.setItem(KEY, JSON.stringify(next));
      set({ vaults: next, error: null });
      return fresh.length;
    },
    reviewCard: (root, id, remembered) => change(root, (v) => {
      if (!v.cards.some((c) => c.id === id)) return v;
      return recordActivity({ ...v, cards: v.cards.map((c) => c.id === id ? { ...c, ...nextReview(c.interval, remembered) } : c) }, "reviewed");
    }),
    deleteCard: (root, id) => change(root, (v) => ({ ...v, cards: v.cards.filter((c) => c.id !== id) })),
  };
});
export function learningFor(root: string, vaults = useLearning.getState().vaults): VaultLearning {
  return vaults[rootKey(root)] ?? emptyVault();
}
