// Thème de l'app : « auto » suit le réglage clair/sombre de l'appareil, « clair » et « sombre »
// le forcent. Le choix est mémorisé dans ce navigateur (localStorage, avec repli silencieux).

export type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "fynup-theme";

export function getStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // stockage indisponible (navigation privée, etc.) : on reste en auto
  }
  return "auto";
}

export function storeMode(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // sans effet : le thème s'applique quand même pour cette session
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyMode(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "auto" && systemPrefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
