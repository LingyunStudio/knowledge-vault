/**
 * 语言描述符：在 Crepe 默认全量 language-data 之上补几条库内需要的别名：
 * Bash（官方描述符叫 Shell，名称匹配不到 fence 的 bash，选中态会丢失）、
 * MATLAB（CM 无官方文法，用 legacy octave 近似，仅高亮降级）、
 * JSONL / INI / CMake 复用内置文法。
 */
import { StreamLanguage, LanguageDescription, LanguageSupport } from "@codemirror/language";
import { languages as allLanguages } from "@codemirror/language-data";

function builtin(name: string): LanguageDescription | undefined {
  return allLanguages.find((l) => l.name === name);
}

export const editorLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "Bash",
    alias: ["sh", "zsh", "shellscript"],
    load: () => builtin("Shell")?.load() ?? Promise.reject(),
  }),
  LanguageDescription.of({
    name: "MATLAB",
    alias: ["matlab", "m", "octave"],
    async load() {
      const mod = await import("@codemirror/legacy-modes/mode/octave");
      // StreamLanguage 是 Language，包成 LanguageSupport 供语言选择器加载
      return new LanguageSupport(StreamLanguage.define(mod.octave));
    },
  }),
  LanguageDescription.of({
    name: "JSONL",
    alias: ["jsonl"],
    load: () => builtin("JSON")?.load() ?? Promise.reject(),
  }),
  LanguageDescription.of({
    name: "Properties",
    alias: ["ini", "properties", "conf", "gitconfig"],
    load: () => builtin("Properties")?.load() ?? Promise.reject(),
  }),
  LanguageDescription.of({
    name: "CMake",
    alias: ["cmake"],
    load: () => builtin("CMake")?.load() ?? Promise.reject(),
  }),
  ...allLanguages,
];
