import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Lead } from "../lib/types";

interface SendLog {
  nom: string;
  success: boolean;
  error?: string;
}

interface EnvoiHistorique {
  id: string;
  date_envoi: string;
  statut: string;
  leads: { nom: string } | null;
}

export default function SendScreen({ selected, onClearSelected }: { selected: Set<string>; onClearSelected: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dailyLimit, setDailyLimit] = useState(40);
  const [minDelay, setMinDelay] = useState(60);
  const [maxDelay, setMaxDelay] = useState(180);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [history, setHistory] = useState<EnvoiHistorique[]>([]);
  const stopRef = useRef(false);

  useEffect(() => {
    if (selected.size === 0) {
      setLeads([]);
      return;
    }
    supabase
      .from("leads")
      .select("*")
      .in("id", Array.from(selected))
      .then(({ data }) => setLeads(data ?? []));
  }, [selected]);

  async function loadHistory() {
    const { data } = await supabase
      .from("envois")
      .select("id, date_envoi, statut, leads(nom)")
      .order("date_envoi", { ascending: false })
      .limit(50);
    setHistory((data as unknown as EnvoiHistorique[]) ?? []);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function sleep(ms: number) {
    const steps = Math.ceil(ms / 1000);
    for (let i = steps; i > 0; i--) {
      if (stopRef.current) return;
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
  }

  async function handleStart() {
    const toSend = leads.slice(0, dailyLimit);
    setRunning(true);
    setProgress(0);
    setLogs([]);
    stopRef.current = false;

    for (let i = 0; i < toSend.length; i++) {
      if (stopRef.current) break;
      const lead = toSend[i];

      const { data, error } = await supabase.functions.invoke("send-emails", {
        body: { leadId: lead.id },
      });

      setLogs((prev) => [
        ...prev,
        { nom: lead.nom, success: !error && data?.success, error: error?.message || data?.error },
      ]);
      setProgress(i + 1);

      if (stopRef.current) break;
      if (i < toSend.length - 1) {
        const delay = Math.round(minDelay + Math.random() * (maxDelay - minDelay)) * 1000;
        await sleep(delay);
      }
    }

    setRunning(false);
    onClearSelected();
    loadHistory();
  }

  function handleStop() {
    stopRef.current = true;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-neutral-900">Envoi des emails</h2>
      <p className="mt-1 text-sm text-neutral-500">
        {leads.length} lead(s) sélectionné(s) depuis l'écran précédent.
      </p>

      {leads.length === 0 ? (
        <p className="mt-6 rounded-lg bg-neutral-100 p-4 text-sm text-neutral-500">
          Sélectionne des leads dans l'écran "Leads" avant de lancer un envoi.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <label>
              Limite quotidienne
              <input
                type="number"
                min={1}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                disabled={running}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1"
              />
            </label>
            <label>
              Délai min (s)
              <input
                type="number"
                min={0}
                value={minDelay}
                onChange={(e) => setMinDelay(Number(e.target.value))}
                disabled={running}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1"
              />
            </label>
            <label>
              Délai max (s)
              <input
                type="number"
                min={0}
                value={maxDelay}
                onChange={(e) => setMaxDelay(Number(e.target.value))}
                disabled={running}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!running ? (
              <button
                onClick={handleStart}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              >
                Lancer l'envoi ({Math.min(dailyLimit, leads.length)} email(s))
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white"
              >
                Arrêter
              </button>
            )}
            {running && (
              <span className="text-sm text-neutral-500">
                {progress}/{Math.min(dailyLimit, leads.length)} envoyés
                {countdown > 0 && ` — prochain envoi dans ${countdown}s`}
              </span>
            )}
          </div>

          {logs.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {logs.map((log, i) => (
                <li key={i} className={log.success ? "text-emerald-700" : "text-red-700"}>
                  {log.success ? "✓" : "✗"} {log.nom} {log.error ? `— ${log.error}` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h3 className="mt-10 text-sm font-semibold text-neutral-900">Historique des envois</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {history.map((h) => (
              <tr key={h.id}>
                <td className="px-3 py-2">{h.leads?.nom ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-500">{new Date(h.date_envoi).toLocaleString("fr-CH")}</td>
                <td className={`px-3 py-2 ${h.statut === "succès" ? "text-emerald-700" : "text-red-700"}`}>
                  {h.statut}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-neutral-400">
                  Aucun envoi pour l'instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
