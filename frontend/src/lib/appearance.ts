import { ACCENTS, useSettings } from "../store/settings";

export function initializeAppearance() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const apply = () => {
    const { mode, accent } = useSettings.getState();
    const dark = mode === "dark" || (mode === "system" && media.matches);
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.accent = accent;
    const properties = ["--accent", "--accent-soft", "--accent2", "--selection", "--t1"];
    if (accent === "default") {
      for (const property of properties) root.style.removeProperty(property);
      return;
    }
    const palette = ACCENTS.find((item) => item.id === accent) ?? ACCENTS[0];
    const color = dark ? palette.dark : palette.light;
    root.style.setProperty("--accent", color);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${color} ${dark ? 12 : 8}%, transparent)`);
    root.style.setProperty("--accent2", color);
    root.style.setProperty("--selection", `color-mix(in srgb, ${color} 18%, var(--bg))`);
    root.style.setProperty("--t1", color);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === "knowledge-vault-settings" || event.key === null) {
      void useSettings.persist.rehydrate();
    }
  };
  apply();
  const unsubscribe = useSettings.subscribe(apply);
  media.addEventListener("change", apply);
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    media.removeEventListener("change", apply);
    window.removeEventListener("storage", onStorage);
  };
}
