import { create } from "zustand";
import { persist } from "zustand/middleware";

const MIN_SCALE = 0.85;
const MAX_SCALE = 1.3;
const MIN_SIDEBAR = 190;
const MAX_SIDEBAR = 480;

/** 基准字号系数：fontScale=1（侧栏显示 100%）对应实际 115%。
    115% 是设计基准，存储值只表示相对基准的偏移。 */
export const BASE_FONT_SCALE = 1.15;

export type ColorMode = "light" | "dark" | "system";
export type AccentId = "default" | "blue" | "teal" | "green" | "purple" | "rose";

/** 主题色的浅色与深色配对。 */
export const ACCENTS: { id: AccentId; name: string; light: string; dark: string }[] = [
  { id: "default", name: "赭红", light: "#b23a26", dark: "#e0654a" },
  { id: "blue", name: "靛蓝", light: "#2563eb", dark: "#4c8dff" },
  { id: "teal", name: "青碧", light: "#0d9488", dark: "#2dd4bf" },
  { id: "green", name: "松绿", light: "#16a34a", dark: "#4ade80" },
  { id: "purple", name: "黛紫", light: "#7c3aed", dark: "#a78bfa" },
  { id: "rose", name: "绯粉", light: "#db2777", dark: "#f472b6" },
];

interface SettingsState {
  /** 颜色模式：system 跟随操作系统 */
  mode: ColorMode;
  /** 主题色 id（ACCENTS 之一） */
  accent: AccentId;
  fontScale: number;
  sidebarWidth: number;
  /** 启用后，粘贴/插入的图片先走 upgit 命令上传，失败回退本地 */
  imageUploadEnabled: boolean;
  /** Typora 习惯：图片临时路径会作为最后一个参数追加到该命令 */
  imageUploadCommand: string;
  setMode: (m: ColorMode) => void;
  setAccent: (a: AccentId) => void;
  bumpScale: (delta: number) => void;
  setSidebarWidth: (w: number) => void;
  setImageUpload: (patch: { enabled?: boolean; command?: string }) => void;
}

export const DEFAULT_UPLOAD_COMMAND = "upgit --size-limit 0";

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      mode: "light",
      accent: "default",
      fontScale: 1,
      sidebarWidth: 236,
      imageUploadEnabled: false,
      imageUploadCommand: DEFAULT_UPLOAD_COMMAND,
      setMode: (m) => set({ mode: m }),
      setAccent: (a) => set({ accent: a }),
      bumpScale: (delta) =>
        set((s) => ({
          fontScale: Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, Math.round((s.fontScale + delta) * 100) / 100),
          ),
        })),
      setSidebarWidth: (w) =>
        set({
          sidebarWidth: Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, w)),
        }),
      setImageUpload: (patch) =>
        set((s) => ({
          imageUploadEnabled: patch.enabled ?? s.imageUploadEnabled,
          imageUploadCommand: patch.command ?? s.imageUploadCommand,
        })),
    }),
    {
      name: "knowledge-vault-settings",
      version: 3,
      migrate: (persisted, version) => {
        const s = persisted as Partial<SettingsState & { dark?: boolean }> | undefined;
        return {
          sidebarWidth: 236,
          ...s,
          mode: s?.mode ?? (s?.dark ? "dark" : "light"),
          accent: s?.accent ?? "default",
          fontScale: version < 2
            ? Math.round(((s?.fontScale ?? 1) / BASE_FONT_SCALE) * 100) / 100
            : s?.fontScale ?? 1,
        };
      },
    },
  ),
);
