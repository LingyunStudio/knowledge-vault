import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
const media = new dom.window.EventTarget();
media.matches = false;
window.matchMedia = () => media;

async function moduleUrl(path, replacements) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replace(`"${from}"`, `"${to}"`);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
const settingsUrl = await moduleUrl("../src/store/settings.ts", {
  zustand: import.meta.resolve("zustand"),
  "zustand/middleware": import.meta.resolve("zustand/middleware"),
});
const { useSettings, ACCENTS } = await import(settingsUrl);
const appearanceUrl = await moduleUrl("../src/lib/appearance.ts", { "../store/settings": settingsUrl });
const { initializeAppearance } = await import(appearanceUrl);

test("default settings preserve the original light appearance", () => {
  assert.equal(useSettings.getState().mode, "light");
  assert.equal(useSettings.getState().accent, "default");
  assert.equal(useSettings.getState().fontScale, 1);
});

test("v2 migration preserves font scale, sidebar and upload preferences", () => {
  const migrated = useSettings.persist.getOptions().migrate({ dark: true, fontScale: 1.15, sidebarWidth: 310, imageUploadEnabled: true, imageUploadCommand: "custom-command" }, 2);
  assert.equal(migrated.mode, "dark");
  assert.equal(migrated.accent, "default");
  assert.equal(migrated.fontScale, 1.15);
  assert.equal(migrated.sidebarWidth, 310);
  assert.equal(migrated.imageUploadCommand, "custom-command");
  assert.equal(migrated.imageUploadEnabled, true);
  assert.equal(useSettings.persist.getOptions().migrate({ dark: false }, 2).mode, "light");
});

test("v1 migration converts the old absolute font scale only once", () => {
  const migrated = useSettings.persist.getOptions().migrate({ dark: false, fontScale: 1.15 }, 1);
  assert.equal(migrated.fontScale, 1);
});

test("color modes respond to system changes only in system mode", () => {
  const dispose = initializeAppearance();
  const state = useSettings.getState();
  state.setMode("system");
  assert.equal(document.documentElement.dataset.theme, "light");
  media.matches = true;
  media.dispatchEvent(new window.Event("change"));
  assert.equal(document.documentElement.dataset.theme, "dark");
  state.setMode("light");
  media.dispatchEvent(new window.Event("change"));
  assert.equal(document.documentElement.dataset.theme, "light");
  state.setMode("dark");
  media.matches = false;
  media.dispatchEvent(new window.Event("change"));
  assert.equal(document.documentElement.dataset.theme, "dark");
  dispose();
});

test("every accent supports light and dark; default restores original CSS tokens", () => {
  const dispose = initializeAppearance();
  for (const palette of ACCENTS.filter((item) => item.id !== "default")) {
    useSettings.getState().setAccent(palette.id);
    for (const mode of ["light", "dark"]) {
      useSettings.getState().setMode(mode);
      assert.equal(document.documentElement.style.getPropertyValue("--accent"), palette[mode]);
      assert.equal(document.documentElement.style.getPropertyValue("--t1"), palette[mode]);
    }
  }
  useSettings.getState().setAccent("default");
  for (const property of ["--accent", "--accent-soft", "--accent2", "--selection", "--t1"]) {
    assert.equal(document.documentElement.style.getPropertyValue(property), "");
  }
  dispose();
});

test("appearance persists and other windows rehydrate on storage changes", () => {
  const dispose = initializeAppearance();
  useSettings.getState().setMode("system");
  useSettings.getState().setAccent("teal");
  const saved = JSON.parse(localStorage.getItem("knowledge-vault-settings"));
  assert.equal(saved.version, 3);
  assert.equal(saved.state.mode, "system");
  assert.equal(saved.state.accent, "teal");
  saved.state.mode = "dark";
  saved.state.accent = "blue";
  localStorage.setItem("knowledge-vault-settings", JSON.stringify(saved));
  window.dispatchEvent(new window.StorageEvent("storage", { key: "knowledge-vault-settings" }));
  assert.equal(useSettings.getState().accent, "blue");
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.documentElement.style.getPropertyValue("--accent"), ACCENTS.find((item) => item.id === "blue").dark);
  dispose();
});
