// Qualification IA d'un lead — port du prompt de qualify_lead_with_ai() (lead_agent.py),
// étendu avec le choix du service_cible (spec §Module 1 point 4).

import { callClaude } from "./anthropic.ts";
import type { LeadRow } from "./types.ts";

export interface QualifyResult {
  score: number | null;
  justification: string;
  point_cle: string;
  service_cible: string;
}

export async function qualifyLead(lead: LeadRow, icp: string): Promise<QualifyResult> {
  const prompt = `Tu es un agent de qualification de leads B2B pour FynUp Consulting
(cabinet suisse romand de digitalisation pour PME : dashboards, automatisation, IA, volet
comptabilité/CEFCO).

ICP cible : ${icp}

Lead à évaluer :
- Nom : ${lead.nom}
- Adresse : ${lead.adresse}
- Site web : ${lead.site_web || "aucun site trouvé"}
- Email trouvé : ${lead.email || "aucun"}
- Note Google : ${lead.note_google ?? "n/a"}
- Signaux détectés sur le site : ${lead.signaux_detectes || "aucun signal collecté"}

Quatre choses à produire :

1. SCORE (1 à 5) : fit avec l'ICP.

2. JUSTIFICATION : une phrase sur pourquoi ce score.

3. POINT_CLE : une accroche FACTUELLE et VÉRIFIABLE à utiliser en ouverture d'un email
   de prospection. Règles strictes :
   - Doit s'appuyer sur un signal réel listé ci-dessus (pas d'invention).
   - Doit être spécifique à CE lead, pas une généralité applicable à n'importe qui.
   - Formulée comme une observation neutre, jamais un reproche.
   - Si aucun signal exploitable n'est disponible, écris "aucun point clé fiable disponible"
     plutôt que d'inventer.

4. SERVICE_CIBLE : le service FynUp le plus pertinent pour ce lead, un seul mot parmi :
   dashboard (suivi CA/stock en temps réel, absence d'outil digital) / cefco (comptabilité,
   PME en croissance sans comptable) / automatisation (tâches répétitives, relances,
   facturation manuelle) / autre (si aucun des trois ne colle clairement).

Réponds STRICTEMENT au format :
SCORE: <chiffre>
JUSTIFICATION: <une phrase>
POINT_CLE: <une phrase factuelle et vérifiable, ou "aucun point clé fiable disponible">
SERVICE_CIBLE: <dashboard|cefco|automatisation|autre>`;

  try {
    const text = await callClaude(prompt, 300);

    const scoreMatch = text.match(/SCORE:\s*(\d)/);
    const justMatch = text.match(/JUSTIFICATION:\s*(.+)/);
    const pointCleMatch = text.match(/POINT_CLE:\s*(.+)/);
    const serviceMatch = text.match(/SERVICE_CIBLE:\s*(\w+)/i);

    return {
      score: scoreMatch ? Number(scoreMatch[1]) : null,
      justification: justMatch ? justMatch[1].trim() : "",
      point_cle: pointCleMatch ? pointCleMatch[1].trim() : "",
      service_cible: serviceMatch ? serviceMatch[1].toLowerCase() : "autre",
    };
  } catch (e) {
    console.error(`Erreur qualification IA pour ${lead.nom}:`, e);
    return { score: null, justification: "", point_cle: "", service_cible: "" };
  }
}
