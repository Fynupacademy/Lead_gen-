export interface Lead {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  site_web: string;
  domaine: string;
  adresse: string;
  note_google: number | null;
  signaux_detectes: string;
  score_ia: number | null;
  justification_ia: string;
  point_cle: string;
  service_cible: string;
  secteur: string;
  source_requete: string;
  statut_envoi: "en_attente" | "envoyé" | "répondu" | "ignoré" | "relance_envoyee";
  date_envoi: string | null;
  date_relance: string | null;
  email_override_subject: string;
  email_override_body: string;
  created_at: string;
}

export const DEFAULT_EMAIL_SUBJECT = "Une présentation rapide de FynUp Consulting";

export const SERVICE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  cefco: "CEFCO / Compta",
  automatisation: "Automatisation",
  autre: "Autre",
};

export const SECTEUR_LABELS: Record<string, string> = {
  batiment: "Bâtiment",
  alimentaire: "Alimentaire",
  personne: "Coiffure/Beauté",
  generique: "Générique",
  restauration: "Restauration",
};

export const STATUT_LABELS: Record<string, string> = {
  en_attente: "En attente",
  envoyé: "Envoyé",
  répondu: "Répondu",
  ignoré: "Ignoré",
  relance_envoyee: "Relancé",
};

export const RELANCE_DELAI_MS = 7 * 24 * 60 * 60 * 1000;

export function isRelanceEligible(lead: Pick<Lead, "statut_envoi" | "date_envoi">): boolean {
  return (
    lead.statut_envoi === "envoyé" &&
    !!lead.date_envoi &&
    Date.now() - new Date(lead.date_envoi).getTime() >= RELANCE_DELAI_MS
  );
}
