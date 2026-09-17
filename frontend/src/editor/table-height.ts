import { remarkPluginsCtx, type Editor } from "@milkdown/kit/core";
import { tableSchema, tableRowSchema, tableHeaderRowSchema } from "@milkdown/kit/preset/gfm";
import type { MarkdownNode } from "@milkdown/kit/transformer";

export const MIN_ROW_HEIGHT = 24;
export const MAX_ROW_HEIGHT = 1200;

export function normalizeRowHeight(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_ROW_HEIGHT && value <= MAX_ROW_HEIGHT
    ? Math.round(value) : null;
}

interface TableAst {
  type: string;
  value?: string;
  rowHeight?: number | null;
  children?: TableAst[];
}

// GFM 无行高语法；紧邻表格的注释保留尺寸，其他 Markdown 阅读器仍显示普通表格。
export function tableHeightRemark() {
  return (tree: TableAst) => {
    const walk = (parent: TableAst) => {
      const children = parent.children;
      if (!children) return;
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        const table = children[i + 1];
        if (node.type === "html" && table?.type === "table" && node.value && node.value.length < 100000) {
          const match = /^<!--kv-table-heights:v1 (\[[\d,null\s]*\])-->$/.exec(node.value.trim());
          if (match) {
            try {
              const heights: unknown = JSON.parse(match[1]);
              if (Array.isArray(heights) && heights.length === table.children?.length && heights.every(h => h === null || normalizeRowHeight(h) !== null)) {
                table.children.forEach((row, index) => { row.rowHeight = normalizeRowHeight(heights[index]); });
                children.splice(i, 1);
              }
            } catch { /* 非法元数据不作为行高应用。 */ }
          }
        }
        walk(children[i]);
      }
    };
    walk(tree);
  };
}

export function tableHeightFeature(editor: Editor) {
  editor.config((ctx) => {
    ctx.update(remarkPluginsCtx, plugins => [...plugins, { plugin: tableHeightRemark, options: {} }]);
    for (const schema of [tableRowSchema, tableHeaderRowSchema]) {
      ctx.update(schema.key, previous => context => {
        const spec = previous(context);
        const header = schema === tableHeaderRowSchema;
        return {
          ...spec,
          attrs: { ...spec.attrs, rowHeight: { default: null } },
          parseDOM: [{
            tag: header ? "tr[data-is-header], tr:has(th)" : "tr",
            getAttrs: dom => {
              const element = dom as HTMLElement;
              if (!header && (element.hasAttribute("data-is-header") || element.querySelector("th"))) return false;
              return { rowHeight: normalizeRowHeight(Number.parseFloat(element.style.height)) };
            },
          }],
          toDOM: node => {
            const height = normalizeRowHeight(node.attrs.rowHeight);
            return ["tr", { ...(header ? { "data-is-header": "true" } : {}), ...(height ? { style: `height: ${height}px` } : {}) }, 0];
          },
          parseMarkdown: {
            ...spec.parseMarkdown,
            runner: (state, node, type) => {
              const align = node.align as (string | null)[];
              const children = (node.children as MarkdownNode[]).map((cell, index) => ({ ...cell, align: align[index], ...(header ? { isHeader: true } : {}) }));
              state.openNode(type, { rowHeight: normalizeRowHeight(node.rowHeight) });
              state.next(children);
              state.closeNode();
            },
          },
        };
      });
    }
    ctx.update(tableSchema.key, previous => context => {
      const spec = previous(context);
      return {
        ...spec,
        toMarkdown: {
          ...spec.toMarkdown,
          runner: (state, node) => {
            const heights: (number | null)[] = [];
            node.forEach(row => heights.push(normalizeRowHeight(row.attrs.rowHeight)));
            if (heights.some(height => height !== null)) state.addNode("html", undefined, `<!--kv-table-heights:v1 ${JSON.stringify(heights)}-->`);
            spec.toMarkdown.runner(state, node);
          },
        },
      };
    });
  });
}
