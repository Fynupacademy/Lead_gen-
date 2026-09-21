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
  source_requete: string;
  statut_envoi: "en_attente" | "envoyé" | "répondu" | "ignoré";
  date_envoi: string | null;
  created_at: string;
}

export const SERVICE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  cefco: "CEFCO / Compta",
  automatisation: "Automatisation",
  autre: "Autre",
};

export const STATUT_LABELS: Record<string, string> = {
  en_attente: "En attente",
  envoyé: "Envoyé",
  répondu: "Répondu",
  ignoré: "Ignoré",
};
