import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { SECTEUR_LABELS, SERVICE_LABELS, STATUT_LABELS, type Lead } from "../lib/types";

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
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);
  const [previewBody, setPreviewBody] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadLeads() {
    setLoading(true);
    const { data } = await supabase
      .from("leads")
      .select("*")
      .order("score_ia", { ascending: false, nullsFirst: false });
    setLeads(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadLeads();
  }, []);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if ((l.score_ia ?? 0) < minScore) return false;
      if (statutFilter !== "tous" && l.statut_envoi !== statutFilter) return false;
      if (serviceFilter !== "tous" && l.service_cible !== serviceFilter) return false;
      if (secteurFilter !== "tous" && l.secteur !== secteurFilter) return false;
      return true;
    });
  }, [leads, minScore, statutFilter, serviceFilter, secteurFilter]);

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
    setPreviewBody(data?.body ?? data?.error ?? "");
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">Leads ({filtered.length})</h2>
        <button
          onClick={loadLeads}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Rafraîchir
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Score min.
          <input
            type="number"
            min={0}
            max={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-16 rounded-lg border border-neutral-300 px-2 py-1"
          />
        </label>
        <select
          value={statutFilter}
          onChange={(e) => setStatutFilter(e.target.value)}
          className="rounded-lg border border-neutral-300 px-2 py-1"
        >
          <option value="tous">Tous statuts</option>
          {Object.entries(STATUT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="rounded-lg border border-neutral-300 px-2 py-1"
        >
          <option value="tous">Tous services</option>
          {Object.entries(SERVICE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={secteurFilter}
          onChange={(e) => setSecteurFilter(e.target.value)}
          className="rounded-lg border border-neutral-300 px-2 py-1"
        >
          <option value="tous">Tous secteurs</option>
          {Object.entries(SECTEUR_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          onClick={() => selectAllAboveScore(3)}
          className="rounded-lg border border-neutral-300 px-3 py-1 text-neutral-700 hover:bg-neutral-50"
        >
          Sélectionner score ≥ 3
        </button>
        <span className="text-neutral-500">{selected.size} sélectionné(s)</span>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-neutral-500">Chargement...</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-neutral-50">
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
                    <select
                      value={lead.statut_envoi}
                      onChange={(e) => changeStatut(lead.id, e.target.value)}
                      className="rounded-lg border border-neutral-200 bg-transparent px-1.5 py-1 text-xs text-neutral-600"
                    >
                      {Object.entries(STATUT_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-neutral-400">
                    Aucun lead ne correspond aux filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {previewLead && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-neutral-900">Aperçu — {previewLead.nom}</h3>
              <button onClick={() => setPreviewLead(null)} className="text-neutral-400 hover:text-neutral-700">
                ✕
              </button>
            </div>
            {previewLoading ? (
              <p className="mt-4 text-sm text-neutral-500">Génération en cours...</p>
            ) : (
              <pre className="mt-4 whitespace-pre-wrap font-sans text-sm text-neutral-800">{previewBody}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
