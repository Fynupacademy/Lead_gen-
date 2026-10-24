// Génération de l'email de prospection : un template par secteur (texte validé par
// Pierre-Olivier). Le secteur est déterminé une fois à la qualification (Module 1, voir
// qualify.ts) et stocké sur le lead ; ce module se contente de remplir le template
// correspondant, remplissage 100% déterministe (pas de paraphrase, pas de tiret cadratin).
// Un lead sans secteur enregistré est classifié à la volée via Claude, en secours.

import { callClaude } from "./anthropic.ts";

// Deux liens séparés : la vidéo (valeur de production actuelle) et le calculateur.
const LIEN_VIDEO = "https://video.fynup-consulting.ch";
const LIEN_CALCULATEUR = "https://presentation.fynup-consulting.ch";

const SIGNATURE = "Excellente journée,\n\nPierre-Olivier D’Oria\nFynUp Consulting\n+41 76 506 28 71";

export type Secteur = "batiment" | "alimentaire" | "personne" | "generique" | "restauration";
const KNOWN_SECTEURS: Secteur[] = ["batiment", "alimentaire", "personne", "generique", "restauration"];

const SUBJECTS: Record<Secteur, string> = {
  batiment: "6 heures de devis par semaine ?",
  restauration: "Un point de marge, 4 000 CHF par an ?",
  personne: "30 minutes de saisie par jour ?",
  alimentaire: "10 % d’invendus, 20 000 CHF par an ?",
  generique: "Une tâche de 30 minutes par jour ?",
};

export function subjectFor(secteur: string): string {
  return SUBJECTS[(secteur || "").toLowerCase() as Secteur] ?? SUBJECTS.generique;
}

//   (espace insécable) avant les deux-points : évite que le « : » passe seul à la ligne.
const TEMPLATES: Record<Secteur, string> = {
  batiment: `Bonjour à toute l’équipe de {{NomEntreprise}},

Un devis fait à la main prend 45 minutes. Huit par semaine, c’est 6 heures. Souvent le soir, après le chantier.

Je suis Pierre-Olivier D’Oria, consultant FynUp. J’ai développé un devis vocal. Vous dictez sur natel, le devis est prêt, le client signe en ligne, la facture QR suit.

Pas de discours. Je vous le montre en 15 minutes, avec un de vos vrais devis.

J’ai aussi d’autres solutions qui peuvent vous faire gagner du temps, de la productivité et de l’argent. Je les utilise moi-même au quotidien.

Une minute de vidéo :
{{lien_video}}

Pour chiffrer le gain sur votre activité :
{{lien_calculateur}}

Si cela vous intéresse, répondez « oui » et je vous recontacte.

{{signature}}`,

  restauration: `Bonjour à toute l’équipe de {{NomEntreprise}},

Sur 400 000 CHF de chiffre d’affaires, un point de coût matières en trop coûte 4 000 CHF par an. Quand la marge se regarde en fin de mois, il est trop tard pour corriger.

Je suis Pierre-Olivier D’Oria, consultant FynUp. J’ai développé un dashboard sur mesure. Coûts, marges et chiffre d’affaires, jour après jour.

Pas de discours. Je vous le montre en 15 minutes, avec vos chiffres.

J’ai aussi d’autres solutions qui peuvent vous faire gagner du temps, de la productivité et de l’argent. Je les utilise moi-même au quotidien.

Une minute de vidéo :
{{lien_video}}

Pour chiffrer le gain sur votre activité :
{{lien_calculateur}}

Si cela vous intéresse, répondez « oui » et je vous recontacte.

{{signature}}`,

  personne: `Bonjour à toute l’équipe de {{NomEntreprise}},

Reporter la caisse et les rendez-vous à la main, c’est 30 minutes par jour. À 35 CHF de l’heure, sur 220 jours, cela fait 3 850 CHF par an.

Je suis Pierre-Olivier D’Oria, consultant FynUp. J’ai développé un dashboard pour la gestion de salon, sur natel ou PC. Prestations, chiffre d’affaires et encaissements au même endroit.

Pas de discours. Je vous le montre en 15 minutes.

J’ai aussi d’autres solutions qui peuvent vous faire gagner du temps, de la productivité et de l’argent. Je les utilise moi-même au quotidien.

Une minute de vidéo :
{{lien_video}}

Pour chiffrer le gain sur votre activité :
{{lien_calculateur}}

Si cela vous intéresse, répondez « oui » et je vous recontacte.

{{signature}}`,

  alimentaire: `Bonjour à toute l’équipe de {{NomEntreprise}},

Sur 200 000 CHF d’achats par an, 10 % d’invendus ou de pertes, c’est 20 000 CHF. Sans suivi du stock, difficile de le voir.

Je suis Pierre-Olivier D’Oria, consultant FynUp. J’ai développé un dashboard accessible sur natel ou PC. Ventes, stocks et marges en un coup d’œil.

Pas de discours. Je vous le montre en 15 minutes, avec vos chiffres.

J’ai aussi d’autres solutions qui peuvent vous faire gagner du temps, de la productivité et de l’argent. Je les utilise moi-même au quotidien.

Une minute de vidéo :
{{lien_video}}

Pour chiffrer le gain sur votre activité :
{{lien_calculateur}}

Si cela vous intéresse, répondez « oui » et je vous recontacte.

{{signature}}`,

  generique: `Bonjour à toute l’équipe de {{NomEntreprise}},

Une tâche répétitive de 30 minutes par jour. À 35 CHF de l’heure, sur 220 jours, cela fait 3 850 CHF par an. Pour une seule personne.

Je suis Pierre-Olivier D’Oria, consultant FynUp. Je crée des outils sur mesure : devis, finances, suivi clients, automatisation. Je commence par repérer ce qui vous prend du temps, je le chiffre, puis je construis l’outil.

Ces outils peuvent vous faire gagner du temps, de la productivité et de l’argent. Je les utilise moi-même au quotidien.

En 15 minutes, on chiffre ensemble la tâche qui vous coûte le plus.

Une minute de vidéo :
{{lien_video}}

Pour chiffrer le gain sur votre activité :
{{lien_calculateur}}

Si cela vous intéresse, répondez « oui » et je vous recontacte.

{{signature}}`,
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
    .replace(/\{\{NomEntreprise\}\}/g, nom)
    .replace(/\{\{lien_video\}\}/g, LIEN_VIDEO)
    .replace(/\{\{lien_calculateur\}\}/g, LIEN_CALCULATEUR)
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
