/**
 * 颜色选择面板：选中工具栏（或右键菜单）按钮后弹出的小色板。
 * 纯 DOM 实现，定位跟随锚点元素，点选即应用并关闭。
 */

export interface ColorSwatch {
  /** null 表示清除该属性 */
  value: string | null;
  title: string;
}

export type SpanStyleKind = "color" | "backgroundColor";

export const TEXT_COLOR_SWATCHES: ColorSwatch[] = [
  { value: null, title: "默认颜色" },
  { value: "#b23a26", title: "红" },
  { value: "#d97838", title: "橙" },
  { value: "#c79215", title: "黄" },
  { value: "#3a8f4d", title: "绿" },
  { value: "#298bcc", title: "蓝" },
  { value: "#8e6fc1", title: "紫" },
  { value: "#58534a", title: "灰" },
];

export const BG_COLOR_SWATCHES: ColorSwatch[] = [
  { value: null, title: "清除背景" },
  { value: "#fde68a", title: "黄" },
  { value: "#bbf7d0", title: "绿" },
  { value: "#bfdbfe", title: "蓝" },
  { value: "#f9a8d4", title: "粉" },
  { value: "#ddd6fe", title: "紫" },
  { value: "#fed7aa", title: "橙" },
  { value: "#eae6dd", title: "灰" },
];

let openPalette: HTMLElement | null = null;
let listenersBound = false;
/** 最近一次自定义取色（色板里留一格便于复用） */
let lastCustom: string | null = null;

function close(): void {
  if (!openPalette) return;
  const el = openPalette;
  openPalette = null;
  el.remove();
}

function onDocPointerDown(e: PointerEvent): void {
  if (openPalette && !openPalette.contains(e.target as Node)) close();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

function bindGlobalListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
}

export function openSpanPalette(
  anchor: HTMLElement,
  kind: SpanStyleKind,
  onPick: (kind: SpanStyleKind, value: string | null) => void,
): void {
  close();
  bindGlobalListeners();
  const swatches = kind === "color" ? TEXT_COLOR_SWATCHES : BG_COLOR_SWATCHES;

  const makeSwatch = (opts: {
    value: string | null;
    title: string;
    cls?: string;
    onPick?: () => void;
  }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.cls ?? (opts.value ? "kv-palette-swatch" : "kv-palette-swatch kv-palette-clear");
    btn.title = opts.title;
    if (opts.value) btn.style.setProperty("--swatch", opts.value);
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      close();
      if (opts.onPick) opts.onPick();
      else onPick(kind, opts.value);
    });
    return btn;
  };

  const palette = document.createElement("div");
  palette.className = "kv-palette";
  const grid = document.createElement("div");
  grid.className = "kv-palette-grid";
  for (const swatch of swatches) {
    grid.appendChild(makeSwatch(swatch));
  }
  // 最近的自定义颜色
  if (lastCustom) {
    const recent = makeSwatch({ value: lastCustom, title: `上次自定义 ${lastCustom}` });
    grid.appendChild(recent);
  }
  // 自定义取色：调起 WebView 自带取色器（含吸管），确认后应用
  const custom = makeSwatch({
    value: null,
    title: "自定义颜色",
    cls: "kv-palette-swatch kv-palette-custom",
    onPick: () => openNativeColorPicker(kind, onPick),
  });
  grid.appendChild(custom);
  palette.appendChild(grid);
  document.body.appendChild(palette);
  openPalette = palette;

  // 定位：锚点正下方，右对齐；放不下则放上方
  const ar = anchor.getBoundingClientRect();
  const pr = palette.getBoundingClientRect();
  let x = ar.right - pr.width;
  let y = ar.bottom + 6;
  if (y + pr.height > window.innerHeight - 8) y = ar.top - pr.height - 6;
  if (y < 8) y = 8;
  x = Math.max(8, Math.min(x, window.innerWidth - pr.width - 8));
  palette.style.left = `${x}px`;
  palette.style.top = `${y}px`;
}

/** 通过隐藏的 `<input type="color">` 调起 WebView 自带取色器（含吸管）。 */
function openNativeColorPicker(
  kind: SpanStyleKind,
  onPick: (kind: SpanStyleKind, value: string | null) => void,
): void {
  // 先关掉色板：原生取色器是模态弹层，且选完后无需停留在旧色板上
  close();
  const input = document.createElement("input");
  input.type = "color";
  if (lastCustom) input.value = lastCustom;
  input.style.position = "fixed";
  input.style.left = "0";
  input.style.top = "0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  input.style.border = "0";
  input.style.padding = "0";
  document.body.appendChild(input);

  const cleanup = () => {
    input.remove();
  };
  input.addEventListener("change", () => {
    const value = input.value; // 原生取色器统一输出 #rrggbb
    if (value) {
      lastCustom = value;
      onPick(kind, value);
    }
    cleanup();
  });
  input.addEventListener("cancel", cleanup);
  // 用户手势（点击色板格）内调用 click 才能弹出原生取色器
  input.click();
}
