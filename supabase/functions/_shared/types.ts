export interface LeadRow {
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
  statut_envoi: string;
}

export function normalizeDomain(url: string): string {
  if (!url) return "";
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
