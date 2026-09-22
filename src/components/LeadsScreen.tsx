import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  DEFAULT_EMAIL_SUBJECT,
  SECTEUR_LABELS,
  SERVICE_LABELS,
  STATUT_LABELS,
  isRelanceEligible,
  type Lead,
} from "../lib/types";

const HISTORIQUE = "__historique__";
const A_RELANCER = "__a_relancer__";

function scoreColor(score: number | null): string {
  if (score === null) return "bg-neutral-100 text-neutral-500";
  if (score >= 4) return "bg-emerald-100 text-emerald-700";
  if (score >= 3) return "bg-amber-100 text-amber-700";
  return "bg-neutral-100 text-neutral-600";
}

export default function LeadsScreen({
  selected,
  onSelectedChange,
}: {
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [statutFilter, setStatutFilter] = useState<string>("tous");
  const [serviceFilter, setServiceFilter] = useState<string>("tous");
  const [secteurFilter, setSecteurFilter] = useState<string>("tous");
  const [requeteFilter, setRequeteFilter] = useState<string>("");
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewBody, setPreviewBody] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewSaved, setPreviewSaved] = useState(false);
  const [relanceSending, setRelanceSending] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function loadLeads(setDefaultFilter: boolean) {
    setLoading(true);
    const { data } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });
    const rows = data ?? [];
    setLeads(rows);
    setLoading(false);
    // Par défaut, n'afficher que la recherche la plus récente (pas tout l'historique cumulé
    // depuis le début), sauf si l'utilisateur a déjà choisi un filtre explicitement.
    if (setDefaultFilter && rows.length > 0) {
      setRequeteFilter(rows[0].source_requete);
    }
  }

  useEffect(() => {
    loadLeads(true);
  }, []);

  const requetes = useMemo(() => {
    const seen = new Map<string, string>(); // requete -> created_at le plus récent
    for (const l of leads) {
      if (!seen.has(l.source_requete) || l.created_at > seen.get(l.source_requete)!) {
        seen.set(l.source_requete, l.created_at);
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .map(([requete]) => requete);
  }, [leads]);

  const sortedByScore = useMemo(() => {
    return leads
      .filter((l) => {
        if ((l.score_ia ?? 0) < minScore) return false;
        if (statutFilter === A_RELANCER) {
          if (!isRelanceEligible(l)) return false;
        } else if (statutFilter !== "tous" && l.statut_envoi !== statutFilter) {
          return false;
        }
        if (serviceFilter !== "tous" && l.service_cible !== serviceFilter) return false;
        if (secteurFilter !== "tous" && l.secteur !== secteurFilter) return false;
        if (requeteFilter !== HISTORIQUE && requeteFilter !== "" && l.source_requete !== requeteFilter) return false;
        return true;
      })
      .sort((a, b) => (b.score_ia ?? 0) - (a.score_ia ?? 0));
  }, [leads, minScore, statutFilter, serviceFilter, secteurFilter, requeteFilter]);

  const filtered = sortedByScore;

  const relanceEligibleCount = useMemo(() => leads.filter(isRelanceEligible).length, [leads]);

  async function changeStatut(id: string, statut: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, statut_envoi: statut as Lead["statut_envoi"] } : l)));
    await supabase.from("leads").update({ statut_envoi: statut }).eq("id", id);
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  function selectAllAboveScore(score: number) {
    const next = new Set(selected);
    filtered
      .filter((l) => (l.score_ia ?? 0) >= score && l.statut_envoi === "en_attente" && l.email)
      .forEach((l) => next.add(l.id));
    onSelectedChange(next);
  }

  async function openPreview(lead: Lead) {
    setPreviewLead(lead);
    setPreviewSaved(false);
    // Un texte déjà édité et sauvegardé reste affiché tel quel, sans regénérer via Claude.
    if (lead.email_override_body) {
      setPreviewSubject(lead.email_override_subject || DEFAULT_EMAIL_SUBJECT);
      setPreviewBody(lead.email_override_body);
      setPreviewLoading(false);
      return;
    }
    setPreviewSubject(DEFAULT_EMAIL_SUBJECT);
    setPreviewBody("");
    setPreviewLoading(true);
    const { data, error } = await supabase.functions.invoke("preview-email", {
      body: { leadId: lead.id },
    });
    setPreviewLoading(false);
    if (error) {
      setPreviewBody(`Erreur : ${error.message}`);
      return;
    }
    setPreviewSubject(data?.subject || DEFAULT_EMAIL_SUBJECT);
    setPreviewBody(data?.body ?? data?.error ?? "");
  }

  async function savePreview() {
    if (!previewLead) return;
    setPreviewSaving(true);
    const subjectOverride = previewSubject === DEFAULT_EMAIL_SUBJECT ? "" : previewSubject;
    await supabase
      .from("leads")
      .update({ email_override_subject: subjectOverride, email_override_body: previewBody })
      .eq("id", previewLead.id);
    setLeads((prev) =>
      prev.map((l) =>
        l.id === previewLead.id
          ? { ...l, email_override_subject: subjectOverride, email_override_body: previewBody }
          : l,
      ),
    );
    setPreviewSaving(false);
    setPreviewSaved(true);
  }

  async function sendRelance(lead: Lead) {
    setRelanceSending((prev) => new Set(prev).add(lead.id));
    const { data, error } = await supabase.functions.invoke("send-relance", {
      body: { leadId: lead.id },
    });
    setRelanceSending((prev) => {
      const next = new Set(prev);
      next.delete(lead.id);
      return next;
    });
    if (error || !data?.success) {
      alert(`Échec de la relance : ${data?.error || error?.message || "erreur inconnue"}`);
      return;
    }
    setLeads((prev) =>
      prev.map((l) =>
        l.id === lead.id ? { ...l, statut_envoi: "relance_envoyee", date_relance: new Date().toISOString() } : l,
      ),
    );
  }

  async function deleteLead(id: string) {
    if (!confirm("Supprimer ce lead ?")) return;
    setDeleting(true);
    await supabase.from("leads").delete().eq("id", id);
    setLeads((prev) => prev.filter((l) => l.id !== id));
    const next = new Set(selected);
    next.delete(id);
    onSelectedChange(next);
    setDeleting(false);
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Supprimer ces ${selected.size} leads ?`)) return;
    setDeleting(true);
    const ids = Array.from(selected);
    await supabase.from("leads").delete().in("id", ids);
    setLeads((prev) => prev.filter((l) => !selected.has(l.id)));
    onSelectedChange(new Set());
    setDeleting(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-neutral-900">Leads ({filtered.length})</h2>
        <button
          onClick={() => loadLeads(false)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Rafraîchir
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={requeteFilter === HISTORIQUE ? HISTORIQUE : requeteFilter}
          onChange={(e) => setRequeteFilter(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 sm:w-auto"
        >
          {requetes.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
          <option value={HISTORIQUE}>Tout l'historique</option>
        </select>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            Score min.
            <input
              type="number"
              min={0}
              max={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-16 rounded-lg border border-neutral-300 px-2 py-1.5"
            />
          </label>
          <select
            value={statutFilter}
            onChange={(e) => setStatutFilter(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2 py-1.5"
          >
            <option value="tous">Tous statuts</option>
            {relanceEligibleCount > 0 && (
              <option value={A_RELANCER}>À relancer (7j+, {relanceEligibleCount})</option>
            )}
            {Object.entries(STATUT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2 py-1.5"
          >
            <option value="tous">Tous services</option>
            {Object.entries(SERVICE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={secteurFilter}
            onChange={(e) => setSecteurFilter(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2 py-1.5"
          >
            <option value="tous">Tous secteurs</option>
            {Object.entries(SECTEUR_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => selectAllAboveScore(3)}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
          >
            Sélectionner score ≥ 3
          </button>
          {selected.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Supprimer la sélection ({selected.size})
            </button>
          )}
          <span className="text-neutral-500">{selected.size} sélectionné(s)</span>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-neutral-500">Chargement...</p>
      ) : (
        <>
          {/* Vue tableau — masquée sur mobile */}
          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-neutral-200 sm:block">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">Nom</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Point clé</th>
                  <th className="px-3 py-2">Secteur</th>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((lead) => (
                  <tr key={lead.id} className="group hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        disabled={lead.statut_envoi !== "en_attente" || !lead.email}
                        onChange={() => toggle(lead.id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => openPreview(lead)} className="font-medium text-neutral-900 hover:underline">
                        {lead.nom}
                      </button>
                      <div className="text-xs text-neutral-400">{lead.email || "pas d'email"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreColor(lead.score_ia)}`}>
                        {lead.score_ia ?? "?"}/5
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-neutral-600" title={lead.point_cle}>
                      {lead.point_cle}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{SECTEUR_LABELS[lead.secteur] ?? lead.secteur ?? "?"}</td>
                    <td className="px-3 py-2 text-neutral-600">{SERVICE_LABELS[lead.service_cible] ?? lead.service_cible}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={lead.statut_envoi}
                          onChange={(e) => changeStatut(lead.id, e.target.value)}
                          className="rounded-lg border border-neutral-200 bg-transparent px-1.5 py-1 text-xs text-neutral-600"
                        >
                          {Object.entries(STATUT_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                        {isRelanceEligible(lead) && (
                          <button
                            onClick={() => sendRelance(lead)}
                            disabled={relanceSending.has(lead.id)}
                            className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {relanceSending.has(lead.id) ? "Envoi..." : "Relancer"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => deleteLead(lead.id)}
                        disabled={deleting}
                        className="text-neutral-300 opacity-0 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                        title="Supprimer ce lead"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                      Aucun lead ne correspond aux filtres.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Vue cartes — mobile uniquement */}
          <div className="mt-4 space-y-3 sm:hidden">
            {filtered.length === 0 && (
              <p className="rounded-xl border border-neutral-200 py-6 text-center text-sm text-neutral-400">
                Aucun lead ne correspond aux filtres.
              </p>
            )}
            {filtered.map((lead) => (
              <div key={lead.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={selected.has(lead.id)}
                    disabled={lead.statut_envoi !== "en_attente" || !lead.email}
                    onChange={() => toggle(lead.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => openPreview(lead)} className="text-left font-medium text-neutral-900">
                        {lead.nom}
                      </button>
                      <button
                        onClick={() => deleteLead(lead.id)}
                        disabled={deleting}
                        className="shrink-0 px-2 py-1 text-lg leading-none text-neutral-400 disabled:opacity-50"
                        title="Supprimer ce lead"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-xs text-neutral-400">{lead.email || "pas d'email"}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreColor(lead.score_ia)}`}>
                        {lead.score_ia ?? "?"}/5
                      </span>
                      <span className="text-xs text-neutral-500">
                        {SECTEUR_LABELS[lead.secteur] ?? lead.secteur ?? "?"}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {SERVICE_LABELS[lead.service_cible] ?? lead.service_cible}
                      </span>
                    </div>
                    {lead.point_cle && <p className="mt-2 text-xs text-neutral-600">{lead.point_cle}</p>}
                    <select
                      value={lead.statut_envoi}
                      onChange={(e) => changeStatut(lead.id, e.target.value)}
                      className="mt-3 w-full rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-600"
                    >
                      {Object.entries(STATUT_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    {isRelanceEligible(lead) && (
                      <button
                        onClick={() => sendRelance(lead)}
                        disabled={relanceSending.has(lead.id)}
                        className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-sm font-medium text-amber-700 disabled:opacity-50"
                      >
                        {relanceSending.has(lead.id) ? "Envoi..." : "Envoyer la relance"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {previewLead && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-neutral-900">Aperçu — {previewLead.nom}</h3>
              <button onClick={() => setPreviewLead(null)} className="text-neutral-400 hover:text-neutral-700">
                ✕
              </button>
            </div>
            {previewLoading ? (
              <p className="mt-4 text-sm text-neutral-500">Génération en cours...</p>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium uppercase text-neutral-500">Objet</label>
                  <input
                    value={previewSubject}
                    onChange={(e) => {
                      setPreviewSubject(e.target.value);
                      setPreviewSaved(false);
                    }}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase text-neutral-500">Corps du message</label>
                  <textarea
                    value={previewBody}
                    onChange={(e) => {
                      setPreviewBody(e.target.value);
                      setPreviewSaved(false);
                    }}
                    rows={12}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={savePreview}
                    disabled={previewSaving}
                    className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {previewSaving ? "Enregistrement..." : "Enregistrer les modifications"}
                  </button>
                  {previewSaved && <span className="text-sm text-emerald-600">Enregistré — utilisé à l'envoi.</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
