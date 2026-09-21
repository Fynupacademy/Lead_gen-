# Agent de lead generation FynUp

Pipeline complet : Google Maps + Google Search → scraping des sites →
qualification IA (Claude) → écriture dans Google Sheets, sans doublon.

## Installation (une seule fois)

```bash
pip install -r requirements.txt
cp .env.example .env
```

Puis remplis `.env` avec tes clés (voir ci-dessous où les trouver).

## Où récupérer chaque clé

| Clé | Où la trouver |
|---|---|
| `GOOGLE_API_KEY` | console.cloud.google.com → active "Places API" + "Custom Search API" → Identifiants |
| `GOOGLE_CSE_ID` | cse.google.com/cse/all → créer un moteur → cocher "Rechercher sur tout le web" |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `credentials.json` | console.cloud.google.com → IAM → Comptes de service → créer → clé JSON |
| `GOOGLE_SHEET_ID` | dans l'URL de ta Sheet : `docs.google.com/spreadsheets/d/[ICI]/edit` |

**Important** : partage ta Google Sheet (bouton Partager) avec l'adresse email
du compte de service (visible dans le fichier `credentials.json`, champ
`client_email`), avec droits Éditeur — sinon l'agent ne pourra pas écrire.

## Utilisation

```bash
python lead_agent.py --query "boulangeries Saint-Gall" --max-results 20
```

Options :
- `--max-results N` — nombre de leads à viser (défaut 20)
- `--icp "description"` — personnalise le profil cible pour le scoring IA
- `--no-maps` — désactive Google Maps, ne garde que Google Search
- `--no-search` — désactive Google Search, ne garde que Google Maps

Exemple avec ICP personnalisé :

```bash
python lead_agent.py \
  --query "salons de coiffure Saint-Gall" \
  --max-results 30 \
  --icp "Salons indépendants de 1-3 employés, pas de site de réservation en ligne"
```

## Ce que fait le script, étape par étape

1. **Google Maps (Places API)** — cherche les établissements correspondant à la requête, récupère nom, adresse, téléphone, note, site web.
2. **Google Search (Custom Search API)** — complète avec des résultats web (utile pour les entreprises sans fiche Maps).
3. **Scraping** — visite chaque site trouvé pour extraire l'email si absent.
4. **Qualification IA (Claude)** — score chaque lead de 1 à 5 par rapport à ton ICP, avec justification.
5. **Écriture Google Sheets** — ajoute les nouveaux leads triés par score, ignore les doublons (vérifie par nom).

Si `GOOGLE_SHEET_ID` n'est pas configuré, le script exporte automatiquement
en CSV local (`leads_export.csv`) à la place.

## Limites à connaître

- **Google Custom Search API** : 100 requêtes gratuites/jour, puis payant (~5 CHF/1000 requêtes).
- **Google Places API** : facturé à l'usage dès le dépassement du crédit gratuit mensuel (200 CHF/mois offerts par Google Cloud).
- **Scraping** : certains sites bloquent les requêtes automatisées (rare pour des PME locales, mais possible).
- **Qualification IA** : coût Claude ≈ 0.01-0.02 CHF par lead traité selon le modèle utilisé.

## Module d'envoi (send_agent.py)

Une fois que `lead_agent.py` a rempli ta Sheet, lance :

```bash
python send_agent.py --daily-limit 40 --min-score 3
```

**Ce qu'il fait :**
1. Lit la Sheet, garde les leads avec score IA ≥ `--min-score` et pas encore marqués "envoyé".
2. Génère un email personnalisé via Claude (mentionne le manque détecté chez le lead).
3. Ajoute le lien de ta vidéo avatar générique (`VIDEO_URL` dans `.env`).
4. Envoie via SMTP Infomaniak, avec un délai aléatoire entre chaque envoi (anti-spam).
5. Marque chaque lead "envoyé" + date dans la Sheet — jamais de doublon d'envoi.

**Config supplémentaire dans `.env` :**
- `INFOMANIAK_EMAIL` / `INFOMANIAK_PASSWORD` — tes identifiants Infomaniak. Si erreur d'authentification, crée un **mot de passe applicatif** dans Infomaniak Manager (Sécurité → Mots de passe d'application) plutôt que ton mot de passe principal.
- `VIDEO_URL` — le lien vers ta vidéo générique (hébergée où tu veux : Loom, Drive, ton site).
- `SENDER_NAME` — nom affiché comme expéditeur.

**Erreur connue Infomaniak :** `550 Relay denied`. Si ça arrive :
- Vérifie que `INFOMANIAK_EMAIL` correspond exactement à l'adresse du compte (pas un alias).
- Essaie le port 465 avec SSL au lieu de 587/TLS si le problème persiste.
- En dernier recours, passer par un service tiers (Brevo, Mailjet) qui gère mieux l'envoi en masse que du SMTP direct.

**Cadence recommandée :** lance `send_agent.py` une fois par jour (ex: 9h), avec `--daily-limit 40`. Ça respecte ta limite de 30-50/jour et laisse les délais aléatoires (60-180s) étaler l'envoi sur la matinée.

## Prochaines évolutions possibles

- Suivi automatique des réponses (lecture IMAP Infomaniak, marquage "a répondu" dans la Sheet).
- Relance automatique après X jours sans réponse.
- Planifier l'exécution quotidienne automatique (cron ou tâche planifiée).
