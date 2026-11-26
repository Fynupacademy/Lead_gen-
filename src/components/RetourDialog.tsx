import { useState } from "react";
import { CAL_LINK, RETOUR_LABELS, RETOUR_ORDER, calBookingUrl, hasDate, type TypeRetour } from "../lib/retours";
import { supabase } from "../lib/supabase";
import type { Lead } from "../lib/types";

// Date ISO -> valeur d'un champ datetime-local (heure locale).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Classement d'une réponse reçue : type de retour, note libre, date de rendez-vous ou de démo.
// Enregistrer passe le lead en « Répondu ».
export default function RetourDialog({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}) {
  const [type, setType] = useState<TypeRetour | "">(lead.type_retour ?? "");
  const [note, setNote] = useState(lead.note_retour ?? "");
  const [date, setDate] = useState(toLocalInput(lead.date_rdv));
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!type) {
      setError("Choisis un type de retour.");
      return;
    }
    setSaving(true);
    setError("");
    const changes = {
      statut_envoi: "répondu" as const,
      type_retour: type,
      note_retour: note.trim() || null,
      date_rdv: hasDate(type) && date ? new Date(date).toISOString() : null,
    };
    const { error: updateError } = await supabase.from("leads").update(changes).eq("id", lead.id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    onSaved({ ...lead, ...changes });
    onClose();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(CAL_LINK);
      setCopied(true);
    } catch {
      setError(`Copie impossible. Ton lien : ${CAL_LINK}`);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-neutral-900">Retour de {lead.nom}</h3>
            <p className="truncate text-xs text-neutral-500">
              {[lead.email, lead.telephone].filter(Boolean).join(" · ") || "aucune coordonnée"}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium uppercase text-neutral-500">Type de retour</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as TypeRetour | "");
                setError("");
              }}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">Choisir...</option>
              {RETOUR_ORDER.map((t) => (
                <option key={t} value={t}>{RETOUR_LABELS[t]}</option>
              ))}
            </select>
          </label>

          {type === "ne_plus_contacter" && (
            <p className="text-xs text-amber-700">Plus aucun mail ne partira vers cette adresse depuis l'app.</p>
          )}

          {hasDate(type) && (
            <label className="block">
              <span className="block text-xs font-medium uppercase text-neutral-500">
                {type === "demo" ? "Date de la démonstration" : "Date du rendez-vous"}
              </span>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block">
            <span className="block text-xs font-medium uppercase text-neutral-500">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Ce que la personne a dit"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>

          {CAL_LINK && type !== "pas_interesse" && type !== "ne_plus_contacter" && (
            <div className="flex flex-wrap gap-2">
              <a
                href={calBookingUrl(lead)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-fyn px-3 py-1.5 text-sm font-medium text-fyn-dark hover:bg-fyn-light"
              >
                Réserver un créneau
              </a>
              <button
                onClick={copyLink}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                {copied ? "Lien copié" : "Copier mon lien"}
              </button>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
