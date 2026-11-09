import { useEffect, useState } from "react";
import { applyMode, getStoredMode, storeMode, type ThemeMode } from "../lib/theme";

const OPTIONS: { id: ThemeMode; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "Suit le réglage de ton appareil" },
  { id: "light", label: "Clair", title: "Toujours en mode clair" },
  { id: "dark", label: "Sombre", title: "Toujours en mode sombre" },
];

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode);

  useEffect(() => {
    applyMode(mode);
    if (mode !== "auto") return;
    // En auto, on suit l'appareil en direct (ex. bascule jour/nuit automatique du téléphone).
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  function choose(next: ThemeMode) {
    storeMode(next);
    setMode(next);
  }

  return (
    <div role="group" aria-label="Thème" className="flex rounded-lg border border-neutral-200 p-0.5 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => choose(o.id)}
          title={o.title}
          aria-pressed={mode === o.id}
          className={`rounded-md px-2.5 py-1 font-medium ${
            mode === o.id ? "bg-fyn text-fyn-ink" : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
