// Génération de l'email de prospection : un template court par secteur (texte validé par
// Pierre-Olivier). Le secteur est déterminé une fois à la qualification (Module 1, voir
// qualify.ts) et stocké sur le lead ; ce module se contente de remplir le template
// correspondant, remplissage 100% déterministe (pas de paraphrase, pas de tiret cadratin).
// Un lead sans secteur enregistré est classifié à la volée via Claude, en secours.

import { callClaude } from "./anthropic.ts";

// Lien vidéo (secret Supabase), jamais codé en dur dans les templates.
const VIDEO_URL = Deno.env.get("VIDEO_URL") ?? "";
const CALCULATEUR_URL = "https://presentation.fynup-consulting.ch";

const SIGNATURE = "Excellente journée,\n\nPierre-Olivier D'Oria\nFynUp Consulting\n+41 76 506 28 71";

export type Secteur = "batiment" | "alimentaire" | "personne" | "generique" | "restauration";
const KNOWN_SECTEURS: Secteur[] = ["batiment", "alimentaire", "personne", "generique", "restauration"];

const SUBJECTS: Record<Secteur, string> = {
  batiment: "Vos devis, le soir après le chantier ?",
  alimentaire: "Votre stock et vos marges, vous les voyez quand ?",
  personne: "Votre chiffre d'affaires, vous le suivez quand ?",
  generique: "Des outils faits pour votre façon de travailler",
  restauration: "Votre marge, vous la voyez quand ?",
};

export function subjectFor(secteur: string): string {
  return SUBJECTS[(secteur || "").toLowerCase() as Secteur] ?? SUBJECTS.generique;
}

const OUTRO = `Si un point vous parle, répondez simplement « oui » et je vous rappelle.

{{signature}}`;

//   (espace insécable) avant les deux-points : évite que le « : » passe seul à la ligne.
const LIENS = `En 1 minute, ce que je peux vous mettre en place :
{{lien_video}}

Et pour chiffrer les gains potentiels pour votre activité :
{{lien_calculateur}}`;

const TEMPLATES: Record<Secteur, string> = {
  batiment: `{{salutation}}

Dans le bâtiment, les devis et les factures se font souvent le soir, après la journée.

J'ai développé un devis vocal pour ça. Vous dictez sur natel, le client signe en ligne, la facture QR suit.

${LIENS}

${OUTRO}`,

  restauration: `{{salutation}}

Entre les achats, le personnel et le service, la rentabilité se regarde souvent en fin de mois. Quand il est trop tard pour corriger.

J'ai développé un dashboard sur mesure. Coûts, marges et chiffre d'affaires en un coup d'œil, jour après jour.

${LIENS}

${OUTRO}`,

  personne: `{{salutation}}

Entre les rendez-vous et la caisse, le suivi du chiffre d'affaires passe souvent après coup.

J'ai développé un dashboard pensé pour la gestion de salon, sur natel ou PC. Prestations, chiffre d'affaires et encaissements au même endroit.

${LIENS}

${OUTRO}`,

  alimentaire: `{{salutation}}

Entre la production et les ventes, difficile de voir en temps réel où va le chiffre d'affaires.

J'ai développé un dashboard sur natel ou PC. Ventes, stock et marges en un coup d'œil, bien plus simple qu'un tableur.

${LIENS}

${OUTRO}`,

  generique: `{{salutation}}

Chaque entreprise travaille à sa façon. Les logiciels standard obligent à s'adapter.

Je fais l'inverse. Je crée des outils sur mesure : devis, finances, suivi clients, automatisation.

${LIENS}

${OUTRO}`,
};

function classifyPrompt(nom: string, secteurHint: string, serviceCible: string): string {
  return `Tu classes un lead B2B dans un secteur d'activité pour choisir le bon template d'email
de prospection FynUp Consulting. Ne réponds qu'avec le mot-clé de catégorie, rien d'autre.

Lead à classer :
- Nom de l'entreprise : ${nom}
- Requête source (indice sur le secteur) : ${secteurHint || "non précisé"}
- Service FynUp jugé pertinent (indice secondaire) : ${serviceCible || "non précisé"}

Table de routage :
- batiment : peintre, sanitaire, carreleur, électricien, maçon, plâtrier, menuisier, artisan du bâtiment.
- alimentaire : boulangerie, boucherie, épicerie, fromagerie, primeur, commerce alimentaire.
- personne : coiffure, coiffeur, institut de beauté, salon, esthétique, spa (prestations + rendez-vous).
- restauration : restaurant, café, traiteur, bar.
- generique : tout le reste (garage, fleuriste, agence immobilière, consultant, salle de sport, petit commerce divers...).

Déduis le secteur à partir du nom de l'entreprise et de la requête source, même si la langue
est l'allemand ou l'italien (ex: "Bäckerei" = boulangerie = alimentaire, "Friseur" = coiffeur = personne).

Réponds STRICTEMENT avec un seul mot parmi : batiment, alimentaire, personne, restauration, generique.`;
}

async function classifySecteur(nom: string, secteurHint: string, serviceCible: string): Promise<Secteur> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return "generique";
  try {
    const raw = await callClaude(classifyPrompt(nom, secteurHint, serviceCible), 10);
    const match = raw.trim().toLowerCase().match(/batiment|alimentaire|personne|restauration|generique/);
    return (match?.[0] as Secteur) ?? "generique";
  } catch (e) {
    console.error(`Erreur classification secteur pour ${nom}:`, e);
    return "generique";
  }
}

function fillTemplate(secteur: Secteur, nom: string): string {
  let text = TEMPLATES[secteur]
    .replace(/\{\{salutation\}\}/g, `Bonjour à toute l'équipe de ${nom},\n\nJe me présente, Pierre-Olivier, consultant chez FynUp.`)
    .replace(/\{\{lien_video\}\}/g, VIDEO_URL)
    .replace(/\{\{lien_calculateur\}\}/g, CALCULATEUR_URL)
    .replace(/\{\{signature\}\}/g, SIGNATURE);
  // Filet de sécurité : zéro tiret cadratin toléré (règle absolue).
  text = text.replace(/—/g, ",");
  return text;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  secteur: Secteur;
}

export const RELANCE_SUBJECT = "Quelques minutes pour en parler ?";

const RELANCE_TEMPLATE = `Bonjour à toute l'équipe de {{NomEntreprise}},

Je me permets de revenir vers vous, au sujet des outils de gestion dont je vous parlais. C'est mon quotidien, je serais ravi de vous montrer où vous pourriez gagner du temps et de l'argent.

Ça vous dit qu'on en parle ?

${SIGNATURE}`;

// Relance courte, un seul template déterministe (pas de variation par secteur, pas d'appel à
// Claude).
export function generateRelance(nom: string): string {
  let text = RELANCE_TEMPLATE.replace(/\{\{NomEntreprise\}\}/g, nom);
  text = text.replace(/—/g, ",");
  return text;
}

export async function generateEmail(
  nom: string,
  leadSecteur: string,
  secteurHint: string,
  serviceCible: string,
): Promise<GeneratedEmail> {
  const known = (leadSecteur || "").toLowerCase() as Secteur;
  const secteur = KNOWN_SECTEURS.includes(known) ? known : await classifySecteur(nom, secteurHint, serviceCible);

  return { subject: SUBJECTS[secteur], body: fillTemplate(secteur, nom), secteur };
}
