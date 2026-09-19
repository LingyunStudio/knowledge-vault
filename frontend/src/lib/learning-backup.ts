import { learningFor, useLearning, type VaultLearning } from "../store/learning";

export const MAX_LEARNING_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS = 100_000;
const MAX_DAYS = 36_600;
const MAX_DATE_MS = 8_640_000_000_000_000;

function invalid(where: string): never {
  throw new Error(`学习备份数据无效：${where}。未导入任何记录。`);
}
function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(where);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, required: string[], optional: string[], where: string) {
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" ||
        ![...required, ...optional].includes(key) || value[key] === undefined)) invalid(where);
}
function text(value: unknown, max: number, where: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) invalid(where);
}
function number(value: unknown, max: number, where: string, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max ||
      (integer && !Number.isSafeInteger(value))) invalid(where);
}
function relative(value: unknown) {
  text(value, 4096, "文章相对路径");
  if (/^[\\/]|[:\x00-\x1f\x7f]/.test(value) ||
      value.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) invalid("文章路径必须是安全的库内相对路径");
}
function array(value: unknown, max: number, where: string): unknown[] {
  if (!Array.isArray(value) || value.length > max ||
      Object.keys(value).length !== value.length) invalid(where);
  return value;
}
function validDate(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith("0000")) invalid("活动日期");
  const date = new Date(`${key}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) invalid("活动日期");
}

/** Validate the entire payload without coercion, truncation, or dropping unknown fields.
 * Returns an independent JSON snapshot, including legacy short cards with no type field.
 */
export function validateLearningBackup(value: unknown): VaultLearning {
  const vault = object(value, "知识库学习记录");
  fields(vault, ["articles", "cards"], ["activity"], "知识库字段");
  const articles = object(vault.articles, "阅读记录");
  if (Reflect.ownKeys(articles).length > MAX_ITEMS) invalid("阅读记录数量超限");
  for (const rel of Reflect.ownKeys(articles)) {
    relative(rel);
    const record = object(articles[rel as string], "阅读记录");
    fields(record, ["favorite", "visited", "scroll", "status"], [], "阅读记录字段");
    if (typeof record.favorite !== "boolean" ||
        !["unread", "learning", "review", "mastered"].includes(record.status as string)) invalid("阅读状态");
    number(record.visited, MAX_DATE_MS, "阅读时间", true);
    number(record.scroll, 1_000_000_000, "阅读位置");
  }
  const ids = new Set<string>();
  for (const entry of array(vault.cards, MAX_ITEMS, "卡片数量或格式")) {
    const card = object(entry, "卡片");
    fields(card, ["id", "rel", "question", "answer", "due", "interval"],
      ["type", "options", "correctIndex"], "卡片字段");
    text(card.id, 256, "卡片 ID");
    if (ids.has(card.id)) invalid("重复卡片 ID");
    ids.add(card.id);
    relative(card.rel);
    text(card.question, 10_000, "卡片问题");
    text(card.answer, 100_000, "卡片答案");
    number(card.due, MAX_DATE_MS, "复习时间", true);
    number(card.interval, 90, "复习间隔", true);
    if (card.type === "choice") {
      const options = array(card.options, 4, "选择题选项");
      if (options.length !== 4) invalid("选择题必须有四个选项");
      options.forEach((option) => text(option, 500, "选择题选项"));
      if (new Set((options as string[]).map((option) => option.trim())).size !== 4) invalid("选择题选项重复");
      number(card.correctIndex, 3, "选择题正确答案索引", true);
    } else {
      if (card.type !== undefined && card.type !== "short") invalid("卡片类型");
      if (Object.hasOwn(card, "options") || Object.hasOwn(card, "correctIndex")) invalid("简答卡不能含选择题字段");
    }
  }
  if (Object.hasOwn(vault, "activity")) {
    const activity = object(vault.activity, "学习活动");
    if (Reflect.ownKeys(activity).length > MAX_DAYS) invalid("活动天数超限");
    for (const key of Reflect.ownKeys(activity)) {
      if (typeof key !== "string") invalid("活动日期");
      validDate(key);
      const day = object(activity[key], "每日学习记录");
      fields(day, ["read", "created", "reviewed"], [], "每日学习字段");
      const read = array(day.read, MAX_ITEMS, "每日阅读列表");
      read.forEach(relative);
      if (new Set(read).size !== read.length) invalid("每日阅读路径重复");
      number(day.created, MAX_ITEMS, "每日制卡数", true);
      number(day.reviewed, MAX_ITEMS, "每日复习数", true);
    }
  }
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > MAX_LEARNING_BYTES) invalid("学习数据超过 10 MiB");
  return JSON.parse(json) as VaultLearning;
}

export function exportLearningBackup(root: string): VaultLearning {
  const state = useLearning.getState();
  if (state.error) throw new Error(state.error);
  if (!root.trim()) throw new Error("当前知识库尚未就绪。");
  return validateLearningBackup(learningFor(root, state.vaults));
}

export function importLearningBackup(root: string, payload: unknown): void {
  useLearning.getState().importBackup(root, payload, validateLearningBackup);
}
