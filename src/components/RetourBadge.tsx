import { RETOUR_LABELS, RETOUR_STYLES } from "../lib/retours";
import type { Lead } from "../lib/types";

// Étiquette du type de retour d'un lead « Répondu » ; un clic ouvre la fenêtre de classement.
export default function RetourBadge({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  if (lead.statut_envoi !== "répondu") return null;
  return (
    <button
      onClick={onClick}
      title={lead.note_retour ?? undefined}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        lead.type_retour ? RETOUR_STYLES[lead.type_retour].pill : "bg-amber-50 text-amber-700"
      }`}
    >
      {lead.type_retour ? RETOUR_LABELS[lead.type_retour] : "Classer le retour"}
    </button>
  );
}
