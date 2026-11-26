import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { blockedEmails, isBlocked } from "../lib/retours";
import { randomDelayMs, waitBetweenSends } from "../lib/sending";
import type { Lead } from "../lib/types";
import RelanceBatch from "./RelanceBatch";

export type EnvoiMode = "premiers" | "relances";

interface SendLog {
  nom: string;
  success: boolean;
  error?: string;
}

interface EnvoiHistorique {
  id: string;
  date_envoi: string;
  statut: string;
  leads: { nom: string; date_relance: string | null } | null;
}

// Un lead ne reçoit qu'une relance, et au moins 7 jours après le premier mail : un envoi daté de sa
// relance (à une heure près) est donc la relance, les autres sont des premiers mails.
function isRelanceRow(h: EnvoiHistorique): boolean {
  const relance = h.leads?.date_relance;
  return !!relance && new Date(h.date_envoi).getTime() >= new Date(relance).getTime() - 60 * 60 * 1000;
}

export default function SendScreen({
  selected,
  onClearSelected,
  active,
  mode,
  onModeChange,
}: {
  selected: Set<string>;
  onClearSelected: () => void;
  active: boolean;
  mode: EnvoiMode;
  onModeChange: (mode: EnvoiMode) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [dailyLimit, setDailyLimit] = useState(40);
  const [minDelay, setMinDelay] = useState(60);
  const [maxDelay, setMaxDelay] = useState(180);
  const [running, setRunning] = useState(false);
  const [relanceRunning, setRelanceRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [history, setHistory] = useState<EnvoiHistorique[]>([]);
  const stopRef = useRef(false);

  async function loadSelected() {
    if (selected.size === 0) {
      setLeads([]);
      return;
    }
    const [{ data }, refused] = await Promise.all([
      supabase.from("leads").select("*").in("id", Array.from(selected)),
      supabase.from("leads").select("email, type_retour").eq("type_retour", "ne_plus_contacter"),
    ]);
    setBlocked(blockedEmails((refused.data as Lead[] | null) ?? []));
    setLeads((data as Lead[] | null) ?? []);
  }

  async function loadHistory() {
    const { data } = await supabase
      .from("envois")
      .select("id, date_envoi, statut, leads(nom, date_relance)")
      .order("date_envoi", { ascending: false })
      .limit(50);
    setHistory((data as unknown as EnvoiHistorique[]) ?? []);
  }

  // L'écran reste monté en permanence (pour qu'un envoi continue quand on change d'onglet) : on
  // recharge donc à chaque affichage, sauf pendant un envoi.
  useEffect(() => {
    if (!active || running) return;
    loadSelected();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selected]);

  // Avertit avant de fermer ou recharger la page pendant un envoi (il s'arrêterait).
  useEffect(() => {
    if (!running && !relanceRunning) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, relanceRunning]);

  // Seuls les leads en attente et avec une adresse sont envoyés ; les autres sont ignorés (ils
  // peuvent avoir été sélectionnés pour être supprimés).
  const sendable = leads.filter((l) => l.statut_envoi === "en_attente" && l.email && !isBlocked(l, blocked));

  async function handleStart() {
    const toSend = sendable.slice(0, dailyLimit);
    setRunning(true);
    setTotal(toSend.length);
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
        await waitBetweenSends(randomDelayMs(minDelay, maxDelay), stopRef, setCountdown);
      }
    }

    setRunning(false);
    onClearSelected();
    loadHistory();
  }

  function handleStop() {
    stopRef.current = true;
  }

  const modes: { id: EnvoiMode; label: string }[] = [
    { id: "premiers", label: running ? "Premiers mails (en cours)" : "Premiers mails" },
    { id: "relances", label: relanceRunning ? "Relances (en cours)" : "Relances" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-900">Envoi des emails</h2>
        <div role="group" aria-label="Type d'envoi" className="flex rounded-lg border border-neutral-200 p-0.5 text-sm">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => onModeChange(m.id)}
              aria-pressed={mode === m.id}
              className={`rounded-md px-3 py-1 font-medium ${
                mode === m.id ? "bg-fyn text-fyn-ink" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Les deux panneaux restent montés pour ne pas interrompre l'affichage d'un envoi. */}
      <div className={mode === "relances" ? "mt-3" : "hidden"}>
        <RelanceBatch
          active={active && mode === "relances"}
          blocked={running}
          onRunningChange={setRelanceRunning}
          onSent={loadHistory}
        />
      </div>

      <div className={mode === "premiers" ? "mt-3" : "hidden"}>
        <p className="text-sm text-neutral-500">
          {sendable.length} lead(s) prêt(s) à envoyer sur {leads.length} sélectionné(s) depuis l'écran précédent.
          {leads.length > sendable.length && !running && (
            <span className="text-amber-700">
              {" "}
              {leads.length - sendable.length} ignoré(s) : déjà contactés, sans email ou « ne plus contacter ».
            </span>
          )}
        </p>

        {sendable.length === 0 && !running && logs.length === 0 ? (
          <p className="mt-6 rounded-lg bg-neutral-100 p-4 text-sm text-neutral-500">
            {leads.length === 0
              ? 'Sélectionne des leads dans l\'écran "Leads" avant de lancer un envoi.'
              : "Aucun des leads sélectionnés n'est prêt : ils sont déjà contactés ou sans adresse email."}
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
                  disabled={sendable.length === 0 || relanceRunning}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Lancer l'envoi ({Math.min(dailyLimit, sendable.length)} email(s))
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
                  {progress}/{total} envoyés
                  {countdown > 0 && ` · prochain envoi dans ${countdown}s`}
                </span>
              )}
              {relanceRunning && <span className="text-sm text-amber-700">Un envoi de relances est en cours.</span>}
            </div>

            {logs.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {logs.map((log, i) => (
                  <li key={i} className={log.success ? "text-emerald-700" : "text-red-700"}>
                    {log.success ? "✓" : "✗"} {log.nom} {log.error ? `: ${log.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <h3 className="mt-10 text-sm font-semibold text-neutral-900">Historique des envois</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {history.map((h) => (
              <tr key={h.id}>
                <td className="px-3 py-2">{h.leads?.nom ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      isRelanceRow(h) ? "bg-amber-50 text-amber-700" : "bg-fyn-light text-fyn-dark"
                    }`}
                  >
                    {isRelanceRow(h) ? "Relance" : "1er mail"}
                  </span>
                </td>
                <td className="px-3 py-2 text-neutral-500">{new Date(h.date_envoi).toLocaleString("fr-CH")}</td>
                <td className={`px-3 py-2 ${h.statut === "succès" ? "text-emerald-700" : "text-red-700"}`}>
                  {h.statut}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
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
