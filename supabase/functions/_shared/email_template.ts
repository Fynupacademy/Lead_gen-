// Génération de l'email de prospection : un template par secteur (texte validé par
// Pierre-Olivier). Le secteur est déterminé une fois à la qualification (Module 1, voir
// qualify.ts) et stocké sur le lead ; ce module se contente de remplir le template
// correspondant, remplissage 100% déterministe (pas de paraphrase, pas de tiret cadratin).
// Un lead sans secteur enregistré est classifié à la volée via Claude, en secours.

import { callClaude } from "./anthropic.ts";

// Page de prospection (vidéo + plaquette-calculateur), indépendante du site FynUp.
const LIEN_URL = "https://video.fynup-consulting.ch";

const SIGNATURE = "Excellente journée,\n\nPierre-Olivier D’Oria\nFynUp Consulting\n+41 76 506 28 71";

export type Secteur = "batiment" | "alimentaire" | "personne" | "generique" | "restauration";
const KNOWN_SECTEURS: Secteur[] = ["batiment", "alimentaire", "personne", "generique", "restauration"];

const SUBJECTS: Record<Secteur, string> = {
  batiment: "Vos devis, le soir après le chantier ?",
  restauration: "Votre marge, vous la voyez quand ?",
  personne: "Votre chiffre d’affaires, vous le suivez quand ?",
  alimentaire: "Vos stocks et vos marges, vous les voyez quand ?",
  generique: "Des outils faits pour votre façon de travailler",
};

export function subjectFor(secteur: string): string {
  return SUBJECTS[(secteur || "").toLowerCase() as Secteur] ?? SUBJECTS.generique;
}

//   (espace insécable) avant les deux-points : évite que le « : » passe seul à la ligne.
const TEMPLATES: Record<Secteur, string> = {
  batiment: `Bonjour à toute l’équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J’accompagne les entreprises dans leurs projets de gestion et de digitalisation, avec des outils pratiques qui simplifient le suivi de leur activité.

Dans le bâtiment, une fois la journée terminée, il reste souvent les devis à préparer, les factures à envoyer et les clients à relancer. Du temps passé derrière un écran alors qu’on a déjà passé la journée sur le terrain.

J’ai développé une solution qui permet de dicter un devis depuis son natel, de le faire signer en ligne et d’enchaîner avec la facturation QR et les relances automatiques.

En 1 minute, quelques exemples de ce que je peux mettre en place, et de quoi estimer vos gains :
{{lien}}

Si cela vous parle, répondez simplement « oui » et je vous rappelle. Nous pourrons en discuter sans engagement.

{{signature}}`,

  restauration: `Bonjour à toute l’équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J’accompagne les entreprises dans leurs projets de gestion et de digitalisation, avec des outils pratiques qui simplifient le suivi de leur activité.

Entre les achats, le personnel et le rythme du service, il n’est pas toujours facile de savoir où en est réellement la rentabilité. Et quand les chiffres arrivent en fin de mois, il est parfois trop tard pour corriger le tir.

J’ai développé un dashboard qui rassemble le chiffre d’affaires, les coûts et les marges dans une vue claire, pour mieux suivre l’activité et prendre les bonnes décisions au bon moment.

En 1 minute, quelques exemples de ce que je peux mettre en place, et de quoi estimer vos gains :
{{lien}}

Si vous souhaitez en savoir plus, répondez simplement « oui » et je vous rappelle. Nous pourrons en discuter sans engagement.

{{signature}}`,

  personne: `Bonjour à toute l’équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J’accompagne les entreprises dans leurs projets de gestion et de digitalisation, avec des outils pratiques qui simplifient le suivi de leur activité.

Entre les rendez-vous, les prestations et la caisse, le suivi des chiffres passe facilement au second plan. On travaille toute la journée, mais on ne prend pas toujours le temps de voir clairement où en est l’activité.

J’ai développé un dashboard pensé pour les salons, accessible sur natel ou PC, qui centralise le chiffre d’affaires et les encaissements pour suivre l’activité plus simplement.

En 1 minute, quelques exemples de ce que je peux mettre en place, et de quoi estimer vos gains :
{{lien}}

Si vous êtes curieux, répondez simplement « oui » et je vous rappelle. Nous pourrons regarder ensemble ce qui pourrait être utile à votre salon, sans engagement.

{{signature}}`,

  alimentaire: `Bonjour à toute l’équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J’accompagne les entreprises dans leurs projets de gestion et de digitalisation, avec des outils pratiques qui simplifient le suivi de leur activité.

Entre les achats, les stocks, la production et les ventes, il n’est pas toujours évident de savoir ce qui se vend le mieux, ce qui reste en stock et ce qui rapporte réellement.

J’ai développé un dashboard accessible sur natel ou PC, qui rassemble les ventes, les stocks et les marges en un coup d’œil. Une façon plus simple de garder une vue d’ensemble, sans devoir construire et maintenir un tableur complexe.

En 1 minute, quelques exemples de ce que je peux mettre en place, et de quoi estimer vos gains :
{{lien}}

Si vous souhaitez en savoir plus, répondez simplement « oui » et je vous rappelle. Nous pourrons en discuter sans engagement.

{{signature}}`,

  generique: `Bonjour à toute l’équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J’accompagne les entreprises dans leurs projets de gestion et de digitalisation, avec des outils pratiques qui simplifient le suivi de leur activité.

Chaque entreprise a sa façon de travailler, ses habitudes et ses contraintes. Pourtant, les logiciels standards obligent souvent à s’adapter à l’outil, alors que l’inverse serait bien plus pratique.

Chez FynUp, je développe des outils adaptés aux besoins concrets des entreprises : devis, suivi financier, gestion clients et automatisation des tâches répétitives.

L’objectif est simple : gagner du temps, simplifier la gestion et pouvoir se concentrer davantage sur son activité.

En 1 minute, quelques exemples de ce que je peux mettre en place, et de quoi estimer vos gains :
{{lien}}

Si une idée vous interpelle, répondez simplement « oui » et je vous rappelle. Nous pourrons en discuter sans engagement.

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
    .replace(/\{\{lien\}\}/g, LIEN_URL)
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
