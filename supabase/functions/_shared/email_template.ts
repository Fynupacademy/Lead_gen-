// Génération de l'email de prospection — templates validés par secteur (voir
// templates-email-par-secteur.md). Le secteur est déterminé une fois à la qualification
// (Module 1, voir qualify.ts) et stocké sur le lead ; ce module se contente de remplir le
// template correspondant — remplissage 100% déterministe, donc le texte envoyé est mot pour
// mot celui validé par Pierre-Olivier (pas de paraphrase, pas de tiret cadratin, pas de lien
// vidéo halluciné). Un lead sans secteur enregistré (créé avant cette fonctionnalité) est
// classifié à la volée via Claude, en secours.

import { callClaude } from "./anthropic.ts";

const VIDEO_URL = Deno.env.get("VIDEO_URL") ?? "";

export const EMAIL_SUBJECT = "Une présentation rapide de FynUp Consulting";

const SIGNATURE = "Pierre-Olivier D'Oria\nConsultant\n+41 76 506 28 71";

export type Secteur = "batiment" | "alimentaire" | "personne" | "generique" | "restauration";
const KNOWN_SECTEURS: Secteur[] = ["batiment", "alimentaire", "personne", "generique", "restauration"];

const TEMPLATES: Record<Secteur, string> = {
  batiment: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. 20 ans dans l'opérationnel et la gestion d'entreprise, j'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, avec des outils simples que j'utilise moi-même au quotidien.

Entre les chantiers, le temps manque pour les devis et les factures. J'ai développé une application de devis vocal, utilisable sur natel ou PC. Vous dictez, ça génère le document, intégré avec la facturation au code QR aux normes suisses et la relance automatique.

J'ai d'autres solutions aussi, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  alimentaire: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. 20 ans dans l'opérationnel et la gestion d'entreprise, j'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, avec des outils simples que j'utilise moi-même au quotidien.

Entre la production et les ventes, difficile de voir en temps réel où va le chiffre d'affaires. J'ai développé une application dashboard, utilisable sur natel ou PC, qui centralise ventes, stock et marges en un coup d'œil, bien plus simple qu'un tableur à construire soi-même.

J'ai d'autres solutions aussi, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  personne: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, fort de 20 ans dans l'opérationnel, avec des outils simples que j'utilise moi-même au quotidien.

Entre les rendez-vous clients et la caisse, le suivi du chiffre d'affaires passe souvent après coup. J'ai développé une application dashboard, spécialement pensée pour la gestion de salon, utilisable sur natel ou PC. Elle suit les prestations, le chiffre d'affaires, les encaissements, et peut inclure le stock.

J'ai d'autres solutions aussi, vraiment sympas, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  generique: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, fort de 20 ans dans l'opérationnel, avec des outils simples que j'utilise moi-même au quotidien.

Ma conviction est simple : chaque entreprise est différente, ses outils devraient l'être aussi. Plutôt qu'un logiciel standard, des outils adaptés à votre façon de travailler.

J'ai d'autres solutions aussi, vraiment sympas, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  restauration: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. 20 ans dans l'opérationnel et la gestion d'entreprise, j'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, avec des outils simples que j'utilise moi-même au quotidien.

Entre les achats, le personnel et le service, difficile de garder un œil sur la rentabilité au jour le jour. J'ai développé une application dashboard sur mesure, qui centralise coûts, marges et chiffre d'affaires en un coup d'œil, avec un volet marketing digital pour remplir la salle les soirs creux.

J'ai d'autres solutions aussi, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,
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
  let text = TEMPLATES[secteur].replace(/\{\{NomEntreprise\}\}/g, nom);
  // Lien vidéo ajouté en plus de la mention "fynup-consulting.ch" (deux liens distincts), pas
  // codé en dur dans le template — vide si VIDEO_URL n'est pas configuré.
  if (VIDEO_URL) {
    text = text.replace("quelques exemples,", `quelques exemples (${VIDEO_URL}),`);
  }
  // Filet de sécurité : zéro tiret cadratin toléré (règle absolue), même en cas d'aléa du modèle.
  text = text.replace(/—/g, ",");
  return text;
}

export interface GeneratedEmail {
  body: string;
  secteur: Secteur;
}

export const RELANCE_SUBJECT = "Petite relance - FynUp Consulting";

const RELANCE_TEMPLATE = `Bonjour à toute l'équipe de {{NomEntreprise}},

Je me permets de revenir vers vous, au sujet des outils de gestion dont je vous parlais. C'est mon quotidien, je serais ravi de vous montrer où vous pourriez gagner du temps et de l'argent.

Ça vous dit qu'on en parle ?

${SIGNATURE}`;

// Relance courte, un seul template déterministe (pas de variation par secteur, pas d'appel à
// Claude) — même logique que les templates initiaux : texte validé mot pour mot par
// Pierre-Olivier, pas de paraphrase possible.
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

  return { body: fillTemplate(secteur, nom), secteur };
}
