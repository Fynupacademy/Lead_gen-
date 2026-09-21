// Génération de l'email de prospection — templates validés par secteur (voir
// templates-email-par-secteur.md). Claude ne fait QUE classifier le secteur du lead (BATIMENT /
// ALIMENTAIRE / PERSONNE / GENERIQUE / EXCLU) ; le remplissage du texte est 100% déterministe,
// ce qui garantit que le texte envoyé est mot pour mot celui validé par Pierre-Olivier (pas de
// paraphrase, pas de tiret cadratin, pas de lien vidéo halluciné).

import { callClaude } from "./anthropic.ts";

const VIDEO_URL = Deno.env.get("VIDEO_URL") ?? "";

export const EMAIL_SUBJECT = "Une présentation rapide de FynUp Consulting";

const SIGNATURE = "Pierre-Olivier\nFynUp Consulting";

type Category = "BATIMENT" | "ALIMENTAIRE" | "PERSONNE" | "GENERIQUE" | "EXCLU";

const TEMPLATES: Record<Exclude<Category, "EXCLU">, string> = {
  BATIMENT: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. 20 ans dans l'opérationnel et la gestion d'entreprise, j'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, avec des outils simples que j'utilise moi-même au quotidien.

Entre les chantiers, le temps manque pour les devis et les factures. J'ai développé une application de devis vocal, utilisable sur natel ou PC. Vous dictez, ça génère le document, intégré avec la facturation au code QR aux normes suisses et la relance automatique.

J'ai d'autres solutions aussi, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  ALIMENTAIRE: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. 20 ans dans l'opérationnel et la gestion d'entreprise, j'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, avec des outils simples que j'utilise moi-même au quotidien.

Entre la production et les ventes, difficile de voir en temps réel où va le chiffre d'affaires. J'ai développé une application dashboard, utilisable sur natel ou PC, qui centralise ventes, stock et marges en un coup d'œil, bien plus simple qu'un tableur à construire soi-même.

J'ai d'autres solutions aussi, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  PERSONNE: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, fort de 20 ans dans l'opérationnel, avec des outils simples que j'utilise moi-même au quotidien.

Entre les rendez-vous clients et la caisse, le suivi du chiffre d'affaires passe souvent après coup. J'ai développé une application dashboard, spécialement pensée pour la gestion de salon, utilisable sur natel ou PC. Elle suit les prestations, le chiffre d'affaires, les encaissements, et peut inclure le stock.

J'ai d'autres solutions aussi, vraiment sympas, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,

  GENERIQUE: `Bonjour à toute l'équipe de {{NomEntreprise}},

Je suis Pierre-Olivier, fondateur de FynUp. J'accompagne les indépendants et les PME dans leurs projets de gestion et de digitalisation, fort de 20 ans dans l'opérationnel, avec des outils simples que j'utilise moi-même au quotidien.

Ma conviction est simple : chaque entreprise est différente, ses outils devraient l'être aussi. Plutôt qu'un logiciel standard, des outils adaptés à votre façon de travailler.

J'ai d'autres solutions aussi, vraiment sympas, selon vos besoins. Une courte vidéo vous montre quelques exemples, le reste des informations est sur fynup-consulting.ch.

Si ça vous intéresse, j'en discute avec plaisir, sans engagement.

${SIGNATURE}`,
};

function classifyPrompt(nom: string, secteur: string, serviceCible: string): string {
  return `Tu classes un lead B2B dans un secteur d'activité pour choisir le bon template d'email
de prospection FynUp Consulting. Ne réponds qu'avec le mot-clé de catégorie, rien d'autre.

Lead à classer :
- Nom de l'entreprise : ${nom}
- Requête source (indice sur le secteur) : ${secteur || "non précisé"}
- Service FynUp jugé pertinent (indice secondaire) : ${serviceCible || "non précisé"}

Table de routage :
- BATIMENT : peintre, sanitaire, carreleur, électricien, maçon, plâtrier, menuisier, artisan du bâtiment.
- ALIMENTAIRE : boulangerie, boucherie, épicerie, fromagerie, primeur, commerce alimentaire.
- PERSONNE : coiffure, coiffeur, institut de beauté, salon, esthétique, spa (prestations + rendez-vous).
- EXCLU : restaurant, café, traiteur, bar — ne jamais cibler ces commerces.
- GENERIQUE : tout le reste (garage, fleuriste, agence immobilière, consultant, salle de sport, petit commerce divers...).

Déduis le secteur à partir du nom de l'entreprise et de la requête source, même si la langue
est l'allemand ou l'italien (ex: "Bäckerei" = boulangerie = ALIMENTAIRE, "Friseur" = coiffeur = PERSONNE).

Réponds STRICTEMENT avec un seul mot parmi : BATIMENT, ALIMENTAIRE, PERSONNE, EXCLU, GENERIQUE.`;
}

function fillTemplate(template: string, nom: string): string {
  let text = template.replace(/\{\{NomEntreprise\}\}/g, nom);
  // Deux liens distincts : la vidéo s'ajoute entre parenthèses après "quelques exemples", et la
  // mention "fynup-consulting.ch" reste intacte comme second lien (le site).
  if (VIDEO_URL) {
    text = text.replace("quelques exemples,", `quelques exemples (${VIDEO_URL}),`);
  }
  // Filet de sécurité : zéro tiret cadratin toléré (règle absolue), même en cas d'aléa du modèle.
  text = text.replace(/—/g, ",");
  return text;
}

export interface GeneratedEmail {
  excluded: boolean;
  body: string;
  category: Category;
}

export async function generateEmail(
  nom: string,
  secteur: string,
  serviceCible: string,
): Promise<GeneratedEmail> {
  let category: Category = "GENERIQUE";

  if (Deno.env.get("ANTHROPIC_API_KEY")) {
    try {
      const raw = await callClaude(classifyPrompt(nom, secteur, serviceCible), 10);
      const match = raw.trim().toUpperCase().match(/BATIMENT|ALIMENTAIRE|PERSONNE|EXCLU|GENERIQUE/);
      if (match) category = match[0] as Category;
    } catch (e) {
      console.error(`Erreur classification secteur pour ${nom}:`, e);
    }
  }

  if (category === "EXCLU") {
    return { excluded: true, body: "", category };
  }

  return { excluded: false, body: fillTemplate(TEMPLATES[category], nom), category };
}
