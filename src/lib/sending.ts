import type { RefObject } from "react";

// Pause entre deux envois, avec compte à rebours. Basée sur une heure de fin et non sur un nombre
// de « ticks » : un onglet en arrière-plan ralentit les minuteries du navigateur, ce qui aurait
// sinon allongé les pauses bien au-delà du délai choisi.
export async function waitBetweenSends(
  ms: number,
  stopRef: RefObject<boolean>,
  onTick: (secondsLeft: number) => void,
): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stopRef.current) break;
    onTick(Math.ceil((end - Date.now()) / 1000));
    await new Promise((r) => setTimeout(r, Math.min(1000, end - Date.now())));
  }
  onTick(0);
}

export function randomDelayMs(minSeconds: number, maxSeconds: number): number {
  const min = Math.max(0, minSeconds);
  const max = Math.max(min, maxSeconds);
  return Math.round(min + Math.random() * (max - min)) * 1000;
}

export function isToday(iso: string | null): boolean {
  return !!iso && new Date(iso).toDateString() === new Date().toDateString();
}

// Message d'erreur lisible d'une Edge Function : le corps de la réponse si on peut le lire, sinon le
// message générique du client.
export async function readFunctionError(
  error: { message?: string; context?: unknown } | null,
  data: { error?: string } | null,
): Promise<string> {
  if (data?.error) return data.error;
  const ctx = error?.context;
  if (ctx instanceof Response) {
    try {
      const json = await ctx.clone().json();
      if (json?.error) return String(json.error);
    } catch {
      // corps illisible : on retombe sur le message générique
    }
  }
  return error?.message || "erreur inconnue";
}
