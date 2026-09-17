/**
 * front matter 按行改写 —— 绝不整体重序列化 YAML，
 * 以保住注释、未知键与原文排版。所有文件均为扁平 `key: value`。
 */

/** 替换（或追加）front matter 中的 title 行，返回新的 fmRaw。 */
export function setTitle(fmRaw: string | null, title: string): string {
  const lines = (fmRaw ?? "").split(/\r?\n/).filter((l) => l.length > 0 || true);
  const re = /^title(\s*):/i;
  const next = `title: ${yamlScalar(title)}`;
  const idx = lines.findIndex((l) => re.test(l));
  if (idx >= 0) {
    lines[idx] = next;
    return lines.join("\n");
  }
  return [`title: ${yamlScalar(title)}`, ...lines].join("\n");
}

/** 需要引号包裹时按 YAML 双引号规则转义；中文/常规标点裸写。 */
function yamlScalar(v: string): string {
  const s = v.trim();
  const needQuote =
    /[:#\[\]{}&*!|>'"%@`,]/.test(s) ||
    /^\s|\s$/.test(v) ||
    /^(true|false|null|~|yes|no|on|off|-?\d)/i.test(s) && /^-?[\d.\s]/.test(s);
  if (!needQuote && v === s) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 拼成完整文件：--- / front matter / --- / 空行 / 正文。 */
export function composeFile(fmRaw: string | null, body: string): string {
  const fm = (fmRaw ?? "").trim();
  const text = body.replace(/\s+$/, "");
  if (!fm) return `${text}\n`;
  return `---\n${fm}\n---\n\n${text}\n`;
}
