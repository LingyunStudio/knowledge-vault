import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BUILTIN_PROVIDER, type AiProvider } from "../lib/ai-presets";

interface AiState {
  /** 用户自定义供应商；内置 Agnes 永远存在，不入库 */
  providers: AiProvider[];
  activeId: string;
  settingsOpen: boolean;
  addProvider: (p: Omit<AiProvider, "id">) => string;
  updateProvider: (id: string, patch: Partial<Omit<AiProvider, "id">>) => void;
  removeProvider: (id: string) => void;
  setActive: (id: string) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useAi = create<AiState>()(
  persist(
    (set) => ({
      providers: [],
      activeId: BUILTIN_PROVIDER.id,
      settingsOpen: false,
      addProvider: (p) => {
        const id = `ai-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        set((s) => ({ providers: [...s.providers, { ...p, id }] }));
        return id;
      },
      updateProvider: (id, patch) =>
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        })),
      removeProvider: (id) =>
        set((s) => ({
          providers: s.providers.filter((p) => p.id !== id),
          activeId: s.activeId === id ? BUILTIN_PROVIDER.id : s.activeId,
        })),
      setActive: (id) => set({ activeId: id }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
    }),
    {
      name: "knowledge-vault-ai",
      version: 1,
      partialize: (s) => ({
        providers: s.providers,
        activeId: s.activeId,
      }),
    },
  ),
);

/** 全部可选供应商（内置在前）。仅用于渲染层展示，勿作 zustand selector。 */
export function allProviders(s: Pick<AiState, "providers">): AiProvider[] {
  return [BUILTIN_PROVIDER, ...s.providers];
}

/** 当前生效的供应商；activeId 失效时回退到内置（返回引用稳定）。 */
export function activeProvider(
  s: Pick<AiState, "providers" | "activeId">,
): AiProvider {
  if (s.activeId === BUILTIN_PROVIDER.id) return BUILTIN_PROVIDER;
  return s.providers.find((p) => p.id === s.activeId) ?? BUILTIN_PROVIDER;
}
