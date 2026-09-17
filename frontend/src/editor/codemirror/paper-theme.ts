/** CodeMirror 纸感主题：颜色全部走 CSS 变量，深浅切换无需重建编辑器。 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const syntax = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-func)" },
  { tag: [t.typeName, t.className, t.namespace, t.labelName], color: "var(--syn-type)" },
  { tag: [t.tagName], color: "var(--syn-tag)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--syn-attr)" },
  { tag: t.operator, color: "var(--syn-operator)" },
  { tag: t.punctuation, color: "var(--syn-punct)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--syn-meta)" },
  { tag: [t.regexp], color: "var(--syn-string)" },
]);

export const paperCodeTheme = [
  syntaxHighlighting(syntax),
  EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      color: "var(--text)",
      fontSize: "13.5px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.65",
    },
    ".cm-content": {
      padding: "8px 0",
      whiteSpace: "pre-wrap",
    },
    ".cm-line": {
      padding: "0 16px",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--text-faint)",
      border: "none",
      fontFamily: "var(--font-mono)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 12px",
      minWidth: "2.6em",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-dim)" },
    "& .cm-cursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, & .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--selection) !important",
    },
    ".cm-selectionMatch": { backgroundColor: "transparent" },
    ".cm-matchingBracket": { backgroundColor: "transparent", color: "inherit" },
    ".cm-searchMatch": { backgroundColor: "var(--selection)" },
  }),
];
