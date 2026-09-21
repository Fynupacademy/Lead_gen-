# FynUp Lead Gen — App web

Version app web du pipeline `lead_agent.py` / `send_agent.py` : recherche de leads (Google Maps +
Google Search), qualification IA (Claude), envoi d'emails personnalisés (SMTP Infomaniak) — avec
interface web, base Supabase, et suivi en temps réel des envois. Voir `SPEC_APP_CLAUDE_CODE.md`
pour la spec complète.

## Stack

- **Frontend** : React + TypeScript + Vite + Tailwind CSS
- **Backend** : Supabase (Postgres + Auth + Edge Functions en Deno/TypeScript)
- **IA** : Anthropic (Claude) — qualification des leads + génération des emails
- **Envoi** : SMTP Infomaniak (via [denomailer](https://deno.land/x/denomailer))

## Mise en place

Le projet Supabase est déjà provisionné (org **FynUp Consulting**, plan gratuit) :

- Project ref : `nxekblochrpjdoqwljgr`
- URL : `https://nxekblochrpjdoqwljgr.supabase.co`
- Dashboard : https://supabase.com/dashboard/project/nxekblochrpjdoqwljgr
- Schéma DB (`leads` + `envois`) appliqué (`supabase/migrations/0001_init.sql`).
- Les 3 Edge Functions (`search-leads`, `send-emails`, `preview-email`) sont déployées et actives.
- `.env.local` (frontend) est déjà rempli avec l'URL et la clé `anon` du projet.

Il reste deux étapes manuelles, volontairement laissées de côté ici (clés API et mot de passe
SMTP ne doivent pas transiter par un agent) :

### 1. Configurer les secrets des Edge Functions

Les fonctions ont besoin des mêmes clés que les scripts Python d'origine — voir
`supabase/functions/.env.example` pour le détail de chaque clé et où la récupérer (Google Cloud
Console, Anthropic Console, Infomaniak).

Soit via le dashboard (**Project Settings → Edge Functions → Secrets**), soit via la CLI :

```bash
npm install -g supabase
supabase login
supabase link --project-ref nxekblochrpjdoqwljgr
cp supabase/functions/.env.example supabase/functions/.env
# remplis supabase/functions/.env avec tes clés
supabase secrets set --env-file supabase/functions/.env
```

### 2. Créer ton compte utilisateur (auth)

L'app utilise l'authentification Supabase par **lien magique** (pas de mot de passe à gérer).
Lance l'app (`npm run dev`) et connecte-toi avec ton email — le premier lien magique crée le
compte. Si l'auto-inscription est désactivée par défaut sur le projet, active-la dans
**Authentication → Providers → Email**, ou ajoute directement ton email dans
**Authentication → Users** sur le dashboard.

### Lancer le frontend

```bash
npm install
npm run dev
```

## Utilisation

1. **Écran Recherche** — lance une recherche (ex: "boulangeries Saint-Gall"), choisit un nombre de
   résultats et éventuellement un service à cibler en priorité. La recherche + scraping +
   qualification IA + écriture en base se fait côté serveur (Edge Function `search-leads`).
2. **Écran Leads** — tableau trié par score, filtrable par score/statut/service, aperçu de l'email
   généré au clic sur un lead, sélection multiple pour l'envoi.
3. **Écran Envoi** — lance l'envoi des leads sélectionnés avec une limite quotidienne et un délai
   aléatoire anti-spam entre chaque envoi (60-180s par défaut) ; suivi en temps réel + historique.

## Points d'attention

- **Rythme d'envoi côté navigateur** : contrairement au script Python, l'envoi est piloté par le
  frontend (une Edge Function ne peut pas rester "endormie" pendant des dizaines de minutes) — il
  faut donc garder l'onglet ouvert pendant la campagne d'envoi. Une évolution possible (hors V1) :
  déplacer la pacing logique vers un job planifié (`pg_cron` + Edge Function).
- **Rate limits** : Google Custom Search = 100 requêtes gratuites/jour ; Places API facturée à
  l'usage au-delà du crédit gratuit Google Cloud (200 CHF/mois). Garde `maxResults` raisonnable
  (~20-30) pour rester dans le temps d'exécution d'une Edge Function.
- **SMTP Infomaniak** : utilise un mot de passe applicatif (Infomaniak Manager → Sécurité → Mots
  de passe d'application), pas le mot de passe principal du compte. Erreur fréquente
  `550 Relay denied` → vérifie que `INFOMANIAK_EMAIL` correspond exactement à l'adresse du compte,
  ou essaie le port 465/SSL.
- **Suivi des réponses (IMAP)** et **relance automatique** : hors scope V1, voir spec.

## Scripts CLI d'origine

`reference/lead_agent.py` et `reference/send_agent.py` restent utilisables en standalone si
besoin (voir `reference/README_CLI.md`) — cette app en est le portage web, la logique métier
(prompts IA, règles de scraping, qualification, voix d'écriture — `reference/voix-pierrot-SKILL.md`)
est la même. La spec complète est dans `reference/SPEC_APP_CLAUDE_CODE.md`.
