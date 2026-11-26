import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { isToday, randomDelayMs, readFunctionError, waitBetweenSends } from "../lib/sending";
import { SECTEUR_LABELS, isRelanceEligible, type Lead } from "../lib/types";
import RelanceDialog from "./RelanceDialog";

// Au-delà, les filtres anti-spam risquent de pénaliser la boîte d'envoi.
const DAILY_ADVICE = 40;
const MAX_CONSECUTIVE_FAILURES = 3;

interface Log {
  nom: string;
  success: boolean;
  error?: string;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// Envoi groupé des relances : mêmes réglages que les premiers mails (nombre, pause entre deux
// envois), avec le texte proposé pour chaque métier. Rien ne part sans clic sur « Lancer ».
export default function RelanceBatch({
  active,
  blocked,
  onRunningChange,
  onSent,
}: {
  active: boolean;
  blocked: boolean;
  onRunningChange: (running: boolean) => void;
  onSent: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [secteur, setSecteur] = useState("tous");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(30);
  const [minDelay, setMinDelay] = useState(60);
  const [maxDelay, setMaxDelay] = useState(180);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [logs, setLogs] = useState<Log[]>([]);
  const [notice, setNotice] = useState("");
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);
  const stopRef = useRef(false);

  async function load() {
    const { data } = await supabase.from("leads").select("*");
    setLeads((data as Lead[] | null) ?? []);
  }

  // Liste rafraîchie à chaque ouverture de l'onglet (jamais pendant un envoi en cours).
  useEffect(() => {
    if (active && !running) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const eligible = leads
    .filter((l) => isRelanceEligible(l) && l.email)
    .sort((a, b) => (b.score_ia ?? 0) - (a.score_ia ?? 0) || (a.date_envoi! < b.date_envoi! ? -1 : 1));
  const shown = eligible.filter((l) => secteur === "tous" || l.secteur === secteur);
  const checked = shown.filter((l) => !excluded.has(l.id));
  const batch = checked.slice(0, Math.max(0, limit));
  const batchIds = new Set(batch.map((l) => l.id));

  const firstToday = leads.filter((l) => isToday(l.date_envoi)).length;
  const relancesToday = leads.filter((l) => isToday(l.date_relance)).length;
  const sentToday = firstToday + relancesToday;
  const estimatedMinutes = Math.round((Math.max(0, batch.length - 1) * (minDelay + Math.max(minDelay, maxDelay))) / 2 / 60);

  function toggle(id: string) {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcluded(next);
  }

  function toggleAll() {
    const next = new Set(excluded);
    if (checked.length === shown.length) shown.forEach((l) => next.add(l.id));
    else shown.forEach((l) => next.delete(l.id));
    setExcluded(next);
  }

  function markRelanced(id: string) {
    const now = new Date().toISOString();
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, statut_envoi: "relance_envoyee", date_relance: now } : l)),
    );
  }

  async function start() {
    const toSend = batch;
    if (toSend.length === 0) return;
    const warning =
      sentToday + toSend.length > DAILY_ADVICE
        ? `\n\nAttention : avec les ${sentToday} mail(s) déjà partis aujourd'hui, tu dépasserais les ${DAILY_ADVICE} conseillés par jour (risque de spam).`
        : "";
    if (!confirm(`Envoyer ${toSend.length} relance(s) ?${warning}`)) return;

    setRunning(true);
    onRunningChange(true);
    setTotal(toSend.length);
    setProgress(0);
    setLogs([]);
    setNotice("");
    stopRef.current = false;
    let failures = 0;

    for (let i = 0; i < toSend.length; i++) {
      if (stopRef.current) break;
      const lead = toSend[i];
      const { data, error } = await supabase.functions.invoke("send-relance", { body: { leadId: lead.id } });
      const success = !error && !!data?.success;
      const message = success ? undefined : await readFunctionError(error, data);
      setLogs((prev) => [...prev, { nom: lead.nom, success, error: message }]);
      setProgress(i + 1);
      if (success) {
        failures = 0;
        markRelanced(lead.id);
      } else if (++failures >= MAX_CONSECUTIVE_FAILURES) {
        setNotice(`Envoi arrêté après ${failures} échecs d'affilée. Vérifie la boîte d'envoi avant de reprendre.`);
        break;
      }
      if (stopRef.current) break;
      if (i < toSend.length - 1) {
        await waitBetweenSends(randomDelayMs(minDelay, maxDelay), stopRef, setCountdown);
      }
    }

    setRunning(false);
    onRunningChange(false);
    await load();
    onSent();
  }

  const numberInput = (value: number, set: (n: number) => void, min: number) => (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => set(Number(e.target.value))}
      disabled={running}
      className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1"
    />
  );

  return (
    <div>
      <p className="text-sm text-neutral-500">
        {eligible.length} lead(s) à relancer (envoyés depuis 7 jours ou plus, sans réponse). Chacun reçoit le texte
        proposé pour son métier.
      </p>

      <p className={`mt-1 text-sm ${sentToday >= DAILY_ADVICE ? "text-amber-700" : "text-neutral-500"}`}>
        Aujourd'hui : {firstToday} premier(s) mail(s) et {relancesToday} relance(s) déjà partis.
        {sentToday >= DAILY_ADVICE && ` Tu as atteint les ${DAILY_ADVICE} conseillés par jour : mieux vaut reprendre demain.`}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        <label>
          Nombre de relances
          {numberInput(limit, setLimit, 1)}
        </label>
        <label>
          Délai min entre deux (s)
          {numberInput(minDelay, setMinDelay, 0)}
        </label>
        <label>
          Délai max entre deux (s)
          {numberInput(maxDelay, setMaxDelay, 0)}
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!running ? (
          <button
            onClick={start}
            disabled={batch.length === 0 || blocked}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Lancer les relances ({batch.length})
          </button>
        ) : (
          <button
            onClick={() => {
              stopRef.current = true;
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white"
          >
            Arrêter
          </button>
        )}
        {running ? (
          <span className="text-sm text-neutral-500">
            {progress}/{total} traitées
            {countdown > 0 && ` · prochaine dans ${countdown}s`}
          </span>
        ) : (
          batch.length > 1 && <span className="text-sm text-neutral-500">Durée estimée : environ {estimatedMinutes} min</span>
        )}
        {blocked && <span className="text-sm text-amber-700">Un envoi de premiers mails est en cours.</span>}
      </div>

      {running && (
        <p className="mt-2 text-xs text-amber-700">
          Garde cette page ouverte et ton ordinateur allumé jusqu'à la fin. Tu peux changer d'onglet dans l'app.
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-red-600">{notice}</p>}

      {logs.length > 0 && (
        <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-sm">
          {logs.map((log, i) => (
            <li key={i} className={log.success ? "text-emerald-700" : "text-red-700"}>
              {log.success ? "✓" : "✗"} {log.nom} {log.error ? `: ${log.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <select
          value={secteur}
          onChange={(e) => setSecteur(e.target.value)}
          disabled={running}
          className="rounded-lg border border-neutral-300 px-2 py-1.5"
        >
          <option value="tous">Tous secteurs</option>
          {Object.entries(SECTEUR_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-neutral-700">
          <input
            type="checkbox"
            checked={shown.length > 0 && checked.length === shown.length}
            onChange={toggleAll}
            disabled={running}
          />
          Tout cocher ({shown.length})
        </label>
        <span className="text-neutral-400">Les mieux notés partent en premier.</span>
      </div>

      <ul className="mt-3 max-h-96 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200">
        {shown.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-3 py-2">
            <input type="checkbox" checked={!excluded.has(l.id)} onChange={() => toggle(l.id)} disabled={running} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900">{l.nom}</p>
              <p className="truncate text-xs text-neutral-400">
                {SECTEUR_LABELS[l.secteur] ?? "Non classé"} · {l.score_ia ?? "?"}/5 · envoyé il y a{" "}
                {daysSince(l.date_envoi!)} j
              </p>
            </div>
            {batchIds.has(l.id) && (
              <span className="shrink-0 rounded-full bg-fyn-light px-2 py-0.5 text-xs font-medium text-fyn-dark">
                ce lot
              </span>
            )}
            <button
              onClick={() => setPreviewLead(l)}
              disabled={running}
              className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Aperçu
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-neutral-400">Aucune relance en attente.</li>
        )}
      </ul>

      {previewLead && (
        <RelanceDialog
          lead={previewLead}
          onClose={() => setPreviewLead(null)}
          onSent={(l) => {
            markRelanced(l.id);
            onSent();
          }}
        />
      )}
    </div>
  );
}
