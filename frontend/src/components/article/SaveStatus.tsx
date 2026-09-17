export type SaveState = "idle" | "editing" | "saving" | "saved" | "error";

const TEXT: Record<SaveState, string> = {
  idle: "自动保存已开启",
  editing: "● 编辑中",
  saving: "保存中…",
  saved: "✓ 已保存",
  error: "保存失败",
};

export function SaveStatus({ state }: { state: SaveState }) {
  return <span className={`save-status ${state === "idle" ? "" : state}`}>{TEXT[state]}</span>;
}
