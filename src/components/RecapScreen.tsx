import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { SECTEUR_LABELS, STATUT_LABELS, type Lead } from "../lib/types";

const SECTEUR_ORDER = ["batiment", "alimentaire", "personne", "restauration", "generique"];
const STATUT_ORDER: Array<Lead["statut_envoi"]> = ["en_attente", "envoyé", "répondu", "ignoré"];

export default function RecapScreen() {
  const [leads, setLeads] = useState<Pick<Lead, "secteur" | "statut_envoi">[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("leads").select("secteur, statut_envoi");
    setLeads(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const secteurs = Array.from(new Set([...SECTEUR_ORDER, ...leads.map((l) => l.secteur || "?")]));

  function count(secteur: string, statut?: string): number {
    return leads.filter((l) => {
      const s = l.secteur || "?";
      if (s !== secteur) return false;
      return statut ? l.statut_envoi === statut : true;
    }).length;
  }

  const totalEnvoye = leads.filter((l) => l.statut_envoi !== "en_attente" && l.statut_envoi !== "ignoré").length;
  const totalRepondu = leads.filter((l) => l.statut_envoi === "répondu").length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">Récapitulatif par secteur</h2>
        <button
          onClick={load}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Rafraîchir
        </button>
      </div>

      {totalEnvoye > 0 && (
        <p className="mt-2 text-sm text-neutral-500">
          Taux de réponse global : <span className="font-medium text-neutral-900">{totalRepondu}</span> répondu(s)
          sur <span className="font-medium text-neutral-900">{totalEnvoye}</span> envoyé(s) (
          {Math.round((totalRepondu / totalEnvoye) * 100)}%)
        </p>
      )}

      <p className="mt-1 text-xs text-neutral-400">
        "Répondu" est marqué manuellement depuis l'écran Leads — aucune lecture automatique des réponses
        (IMAP) n'est branchée pour l'instant.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-neutral-500">Chargement...</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2">Secteur</th>
                {STATUT_ORDER.map((s) => (
                  <th key={s} className="px-3 py-2 text-right">{STATUT_LABELS[s]}</th>
                ))}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {secteurs.map((secteur) => {
                const rowTotal = count(secteur);
                if (rowTotal === 0) return null;
                return (
                  <tr key={secteur} className="hover:bg-neutral-50">
                    <td className="px-3 py-2 font-medium text-neutral-900">
                      {SECTEUR_LABELS[secteur] ?? (secteur === "?" ? "Non classé" : secteur)}
                    </td>
                    {STATUT_ORDER.map((s) => (
                      <td key={s} className="px-3 py-2 text-right text-neutral-600">{count(secteur, s) || "—"}</td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium text-neutral-900">{rowTotal}</td>
                  </tr>
                );
              })}
              <tr className="bg-neutral-50 font-medium text-neutral-900">
                <td className="px-3 py-2">Total</td>
                {STATUT_ORDER.map((s) => (
                  <td key={s} className="px-3 py-2 text-right">
                    {leads.filter((l) => l.statut_envoi === s).length || "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">{leads.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
