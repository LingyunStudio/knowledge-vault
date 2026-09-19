import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AiProvider } from "../lib/ai-presets";
import { ipc } from "../lib/ipc";

interface AiState {
  /** 用户手动添加的供应商；默认为空，不内置任何模型 */
  providers: AiProvider[];
  activeId: string;
  settingsOpen: boolean;
  /** 仅用于跨窗口广播 Key 变更：值变化让另一窗口的 storage 监听触发重水合 */
  keyRev?: number;
  addProvider: (p: Omit<AiProvider, "id">) => string;
  updateProvider: (id: string, patch: Partial<Omit<AiProvider, "id">>) => void;
  removeProvider: (id: string) => void;
  setActive: (id: string) => void;
  setSettingsOpen: (open: boolean) => void;
  /** 编辑 API Key：内存即时生效，异步写入系统凭据库（不落 localStorage） */
  setApiKey: (id: string, key: string) => void;
}

/**
 * API Key 只存系统凭据库，localStorage 里始终留空。
 * unconfirmed 是「尚未确认写入系统凭据库」的供应商 id 集合：旧版把明文 Key
 * 存在 localStorage，迁移确认成功之前这些 id 的 Key 暂留存储以防丢失，
 * 确认后立即剥离。新输入的 Key 永远不进 localStorage。
 */
const unconfirmed = new Set<string>();

/** 同一供应商的凭据写入串行化，保证连续输入时最后生效的是最后一次输入 */
const keyWrites = new Map<string, Promise<void>>();

/**
 * 迁移 + 水合（每次重水合后运行）：localStorage 里残留明文 Key 的写入系统
 * 凭据库后剥离；Key 为空的从系统凭据库读回内存。凭据库不可用时静默降级——
 * 迁移中的 Key 留在 localStorage 下次重试，水合失败的 Key 留空待重填。
 */
async function syncProviderKeys(): Promise<void> {
  await Promise.allSettled(
    useAi.getState().providers.map(async (p) => {
      if (p.apiKey && unconfirmed.has(p.id)) {
        const current = useAi.getState().providers.find((q) => q.id === p.id);
        if (!current || current.apiKey !== p.apiKey) {
          // 用户已改过 Key（走 setApiKey 流程）：这里只剥离旧值
          unconfirmed.delete(p.id);
          useAi.setState((s) => ({ providers: [...s.providers] }));
          return;
        }
        try {
          await ipc.credentialSet(p.id, p.apiKey);
          unconfirmed.delete(p.id);
          // 触发一次持久化，把 localStorage 中的明文覆盖为空
          useAi.setState((s) => ({ providers: [...s.providers] }));
        } catch (e) {
          console.warn("API Key 迁移到系统凭据库失败：", e);
        }
      } else if (!p.apiKey) {
        try {
          const key = await ipc.credentialGet(p.id);
          // 凭据库是权威来源：读到与否都清除迁移标记，避免把水合来的 Key 写回存储
          unconfirmed.delete(p.id);
          if (!key) return;
          useAi.setState((s) => ({
            providers: s.providers.map((q) =>
              q.id === p.id && !q.apiKey ? { ...q, apiKey: key } : q,
            ),
          }));
        } catch (e) {
          console.warn("从系统凭据库读取 API Key 失败：", e);
        }
      }
    }),
  );
}

export const useAi = create<AiState>()(
  persist(
    (set) => ({
      providers: [],
      activeId: "",
      settingsOpen: false,
      keyRev: 0,
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
      removeProvider: (id) => {
        unconfirmed.delete(id);
        keyWrites.delete(id);
        set((s) => {
          const rest = s.providers.filter((p) => p.id !== id);
          return {
            providers: rest,
            // 删除的是当前供应商时回落到第一个剩余的；没有则回到未选择状态
            activeId: s.activeId === id ? (rest[0]?.id ?? "") : s.activeId,
          };
        });
        void ipc.credentialDelete(id).catch(() => {});
      },
      setActive: (id) => set({ activeId: id }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setApiKey: (id, key) => {
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === id ? { ...p, apiKey: key } : p,
          ),
        }));
        const prev = keyWrites.get(id) ?? Promise.resolve();
        const next = prev
          .then(() => ipc.credentialSet(id, key))
          .then(() => {
            // 广播计数递增：另一窗口经 storage 事件重水合后从凭据库取新 Key
            useAi.setState((s) => ({ keyRev: (s.keyRev ?? 0) + 1 }));
          })
          .catch((e) =>
            console.warn("API Key 写入系统凭据库失败：", e),
          );
        keyWrites.set(id, next);
      },
    }),
    {
      name: "knowledge-vault-ai",
      version: 2,
      // v1 的默认 activeId 指向已移除的内置模型；迁移为首个已添加的供应商（或未选择）
      migrate: (persisted) => {
        const raw = (persisted ?? {}) as Partial<Pick<AiState, "providers" | "activeId" | "keyRev">>;
        const providers = Array.isArray(raw.providers) ? raw.providers : [];
        const active = providers.find((p) => p.id === raw.activeId);
        return {
          providers,
          activeId: active ? active.id : (providers[0]?.id ?? ""),
          keyRev: raw.keyRev ?? 0,
        };
      },
      partialize: (s) => ({
        providers: s.providers.map((p) =>
          unconfirmed.has(p.id) ? p : { ...p, apiKey: "" },
        ),
        activeId: s.activeId,
        keyRev: s.keyRev,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 旧版明文 Key：先同步标记（保证迁移完成前的任何写盘都不丢 Key），再异步迁移。
        // 延迟到微任务再执行：水合发生在 create() 求值期间，此刻 useAi 尚未初始化（TDZ）。
        for (const p of state.providers) {
          if (p.apiKey) unconfirmed.add(p.id);
        }
        void Promise.resolve().then(() => syncProviderKeys());
      },
    },
  ),
);

/** 当前生效的供应商；尚未添加或未选中时返回 null。 */
export function activeProvider(
  s: Pick<AiState, "providers" | "activeId">,
): AiProvider | null {
  return s.providers.find((p) => p.id === s.activeId) ?? null;
}
