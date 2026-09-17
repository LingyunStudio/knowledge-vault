/**
 * 新建表格的行列选择器：右键菜单 / Ctrl+T 弹出的小网格，
 * 悬停高亮 rows×cols 区域（Typora 风格），点选即插入。
 * 纯 DOM 实现，与 span-style/palette 同套路。
 */

const GRID = 10; // 网格最大行列数

let openPicker: HTMLElement | null = null;
let listenersBound = false;

function close(): void {
  if (!openPicker) return;
  const el = openPicker;
  openPicker = null;
  el.remove();
}

function onDocPointerDown(e: PointerEvent): void {
  if (openPicker && !openPicker.contains(e.target as Node)) close();
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

/**
 * 在锚点附近弹出 rows×cols 选择网格。
 * onPick 收到的是「总行数（含表头）」与「列数」。
 */
export function openTablePicker(
  anchor: { x: number; y: number },
  onPick: (rows: number, cols: number) => void,
): void {
  close();
  bindGlobalListeners();

  // 选中态：悬停即更新（保留最后一次悬停的区域），键盘方向键同样生效
  let rows = 3;
  let cols = 3;

  const picker = document.createElement("div");
  picker.className = "kv-table-picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", "选择表格行列数");

  const grid = document.createElement("div");
  grid.className = "kv-table-grid";
  grid.setAttribute("role", "grid");
  grid.title = "悬停选择大小，点击插入（行数含表头）";

  const cells: HTMLButtonElement[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kv-table-cell";
      btn.dataset.r = String(r);
      btn.dataset.c = String(c);
      btn.setAttribute("aria-label", `${r + 1} 行 ${c + 1} 列`);
      cells.push(btn);
      grid.appendChild(btn);
    }
  }

  const label = document.createElement("div");
  label.className = "kv-table-pick-label";

  const paint = () => {
    for (const cell of cells) {
      const on = Number(cell.dataset.r) < rows && Number(cell.dataset.c) < cols;
      cell.classList.toggle("on", on);
    }
    label.textContent = `${rows} 行 × ${cols} 列（含表头）`;
  };

  grid.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest(".kv-table-cell");
    if (!cell) return;
    rows = Number((cell as HTMLElement).dataset.r) + 1;
    cols = Number((cell as HTMLElement).dataset.c) + 1;
    paint();
  });
  // 移出网格回显当前选中大小（不清零，Typora 行为）
  grid.addEventListener("mouseleave", paint);

  grid.addEventListener("click", (e) => {
    const cell = (e.target as HTMLElement).closest(".kv-table-cell") as HTMLElement | null;
    if (!cell) return;
    const r = Number(cell.dataset.r) + 1;
    const c = Number(cell.dataset.c) + 1;
    close();
    onPick(r, c);
  });

  picker.addEventListener("keydown", (e) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key in delta) {
      e.preventDefault();
      e.stopPropagation();
      rows = Math.min(GRID, Math.max(1, rows + delta[e.key][0]));
      cols = Math.min(GRID, Math.max(1, cols + delta[e.key][1]));
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      close();
      onPick(rows, cols);
    }
  });

  picker.appendChild(grid);
  picker.appendChild(label);
  document.body.appendChild(picker);
  openPicker = picker;
  paint();
  grid.querySelector<HTMLElement>('[data-r="2"][data-c="2"]')?.focus();

  // 定位：锚点下方居中，放不下则放上方
  const pr = picker.getBoundingClientRect();
  let x = anchor.x - pr.width / 2;
  let y = anchor.y + 6;
  if (y + pr.height > window.innerHeight - 8) y = anchor.y - pr.height - 6;
  if (y < 8) y = 8;
  x = Math.max(8, Math.min(x, window.innerWidth - pr.width - 8));
  picker.style.left = `${x}px`;
  picker.style.top = `${y}px`;
}
