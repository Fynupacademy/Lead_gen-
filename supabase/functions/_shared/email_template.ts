// Génération de l'email de prospection : un template par secteur (texte validé par
// Pierre-Olivier). Le secteur est déterminé une fois à la qualification (Module 1, voir
// qualify.ts) et stocké sur le lead ; ce module se contente de remplir le template
// correspondant, remplissage 100% déterministe (pas de paraphrase, pas de tiret cadratin).
// Un lead sans secteur enregistré est classifié à la volée via Claude, en secours.

import { callClaude } from "./anthropic.ts";

// Page de prospection (vidéo + plaquette-calculateur), indépendante du site FynUp.
const LIEN_URL = "https://video.fynup-consulting.ch";

const SIGNATURE = "Je vous souhaite une excellente journée,\n\nPierre-Olivier D’Oria\nFynUp Consulting\n+41 76 506 28 71";

export type Secteur = "batiment" | "alimentaire" | "personne" | "generique" | "restauration";
const KNOWN_SECTEURS: Secteur[] = ["batiment", "alimentaire", "personne", "generique", "restauration"];

const SUBJECTS: Record<Secteur, string> = {
  batiment: "Vos devis du soir : 5 750 CHF par an ?",
  restauration: "4 000 CHF par point de coût matières",
  personne: "Votre chiffre d’affaires, vous le suivez quand ?",
  alimentaire: "20 000 CHF d’invendus par an ?",
  generique: "Des outils faits pour votre façon de travailler",
};

export function subjectFor(secteur: string): string {
  return SUBJECTS[(secteur || "").toLowerCase() as Secteur] ?? SUBJECTS.generique;
}

// Structure commune (texte validé par Pierre-Olivier) : accroche chiffrée, l'outil, qui je suis
// (outils digitaux + accompagnement de gestion, que ça aille bien ou mal), la vidéo, le « oui ».
// ¤ = espace insécable (évite un « : » ou un montant coupé en fin de ligne), converti par nb().
const QUI_JE_SUIS = `Je suis Pierre-Olivier D’Oria, de FynUp Consulting. Je conçois des outils sur mesure pour votre gestion de tous les jours, accessibles sur natel ou sur PC. Certifié Anthropic, j’utilise l’intelligence artificielle au quotidien pour vous faire gagner du temps, et je peux aussi vous aider à l’utiliser.

Avec plus de 20 ans d’expérience sur le terrain, j’ai piloté la gestion opérationnelle et financière de portefeuilles allant jusqu’à 15¤millions de chiffre d’affaires. Je connais les problématiques du quotidien d’une entreprise et je peux vous accompagner, pour améliorer vos résultats ou si la situation est compliquée.`;

function nb(text: string): string {
  return text.replaceAll("¤", String.fromCharCode(160));
}

function build(accroche: string, outil: string, cta: string): string {
  return `Bonjour à toute l’équipe de {{NomEntreprise}},

${accroche}

${outil}

${QUI_JE_SUIS}

Pour en savoir plus sur FynUp¤: www.fynup-consulting.ch

Moins d’une minute de vidéo pour découvrir mes services¤:
{{lien}}

${cta}

{{signature}}`;
}

const CTA_SITUATION = "Si ça vous parle, répondez simplement «¤oui¤», je vous le montre en situation.";
const CTA_CHIFFRES = "Si ça vous parle, répondez simplement «¤oui¤», je vous le montre avec vos chiffres.";

const TEMPLATES: Record<Secteur, string> = {
  batiment: build(
    "Un devis le soir, une fois le chantier terminé, c’est au minimum 30¤minutes. Cinq par semaine, ça fait 2¤h¤30 de votre temps. À 50¤CHF de l’heure sur 46¤semaines, on arrive à environ 5¤750¤CHF par an.",
    "C’est pour ça que je développe des solutions digitales, comme une appli vocale¤: vous dictez le devis directement sur le chantier, depuis votre natel, et il est prêt à envoyer. Fini les soirées devant l’ordinateur.",
    CTA_SITUATION,
  ),

  alimentaire: build(
    "Sur 200¤000¤CHF d’achats par an, si 10¤% partent en invendus ou en pertes, c’est 20¤000¤CHF qui s’envolent. Et sans suivi du stock, c’est difficile de le voir.",
    "C’est pour ça que je développe des solutions digitales, comme des tableaux de bord intelligents¤: vos ventes, vos stocks et vos marges en un coup d’œil.",
    CTA_CHIFFRES,
  ),

  restauration: build(
    "Sur 400¤000¤CHF de chiffre d’affaires, un seul point de coût matières en trop, c’est 4¤000¤CHF par an. Et quand on regarde la marge seulement en fin de mois, il est souvent trop tard pour corriger.",
    "C’est pour ça que je développe des solutions digitales, comme des tableaux de bord intelligents¤: vos coûts, vos marges et votre chiffre d’affaires, jour après jour.",
    CTA_CHIFFRES,
  ),

  personne: build(
    "Entre les rendez-vous, les prestations et la caisse, on n’a pas toujours le temps de regarder où en est vraiment l’activité. Le suivi du chiffre d’affaires passe vite au second plan.",
    "C’est pour ça que je développe des solutions digitales, comme des tableaux de bord intelligents¤: votre chiffre d’affaires et vos encaissements en un coup d’œil.",
    CTA_CHIFFRES,
  ),

  generique: build(
    "Chaque entreprise travaille à sa façon, et les logiciels standards obligent souvent à s’adapter à l’outil, alors que ce devrait être l’inverse.",
    "C’est pour ça que je développe des solutions digitales sur mesure¤: devis, suivi financier, gestion des clients, tâches répétitives automatisées.",
    CTA_SITUATION,
  ),
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
  return nb(text);
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  secteur: Secteur;
}

// Relance manuelle (7 jours après l'envoi, jamais automatique) : objet « Re: <objet du premier
// mail> », courte phrase adaptée au métier, même lien. Un seul template déterministe par secteur.
export function relanceSubjectFor(secteur: string): string {
  return `Re: ${subjectFor(secteur)}`;
}

const RELANCE_PHRASES: Record<Secteur, string> = {
  batiment: "vous êtes sur les chantiers toute la journée",
  alimentaire: "vous avez la tête dans le service",
  restauration: "le service prend tout votre temps",
  personne: "vos journées sont bien remplies entre les rendez-vous",
  generique: "vos journées sont bien remplies",
};

export function generateRelance(nom: string, secteur: string): string {
  const key = (secteur || "").toLowerCase() as Secteur;
  const phrase = RELANCE_PHRASES[KNOWN_SECTEURS.includes(key) ? key : "generique"];
  const text = `Bonjour à toute l’équipe de ${nom},

Un petit mot pour ne pas laisser mon mail se perdre dans votre boîte. Je sais que ${phrase}.

La vidéo dure moins d’une minute¤:
${LIEN_URL}

Si ça vous parle, répondez simplement «¤oui¤». Je m’occupe du reste.

${SIGNATURE}`;
  return nb(text.replace(/—/g, ","));
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
