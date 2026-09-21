# FynUp Lead Gen App — Spec technique pour Claude Code

## Contexte

FynUp Consulting (fynup-consulting.ch) est un cabinet suisse romand de digitalisation
pour PME et indépendants (dashboards financiers, automatisation, IA). Fondateur : Pierre-Olivier
("Pierrot"), basé région Saint-Gall, gère aussi un réseau de 5 pâtisseries (Pâtisserie Vincent)
en parallèle.

Objectif de l'app : automatiser la prospection commerciale de bout en bout — trouver des leads
qualifiés, leur envoyer un email personnalisé et humain (jamais générique), suivre les envois.

## Stack technique

- **Frontend** : app web simple (React ou HTML/JS léger — cohérent avec les autres projets
  FynUp existants)
- **Backend** : Supabase (base de données + Edge Functions pour la logique métier)
- **APIs externes** :
  - Google Custom Search API (recherche web)
  - Google Places API (Google Maps — infos établissements)
  - Anthropic API / Claude (qualification des leads + génération des emails)
  - SMTP Infomaniak (envoi des emails)

## Base de données (schéma Supabase)

### Table `leads`
| Colonne | Type | Description |
|---|---|---|
| id | uuid | clé primaire |
| nom | text | nom de l'entreprise |
| email | text | email trouvé (peut être vide) |
| telephone | text | |
| site_web | text | |
| adresse | text | |
| note_google | numeric | note Google Maps si disponible |
| signaux_detectes | text | ex: "pas de HTTPS; pas de réservation en ligne" |
| score_ia | integer | 1-5, généré par Claude |
| justification_ia | text | pourquoi ce score |
| point_cle | text | accroche factuelle pour l'email, ou "aucun point clé fiable disponible" |
| service_cible | text | quel service FynUp cibler (dashboard / CEFCO / automatisation / autre) |
| source_requete | text | la recherche qui a trouvé ce lead |
| statut_envoi | text | "en_attente" / "envoyé" / "répondu" / "ignoré" |
| date_envoi | timestamp | |
| created_at | timestamp | |

### Table `envois` (historique, optionnel mais recommandé)
| Colonne | Type | Description |
|---|---|---|
| id | uuid | |
| lead_id | uuid | référence vers `leads` |
| contenu_email | text | corps de l'email envoyé (pour audit/amélioration du prompt) |
| date_envoi | timestamp | |
| statut | text | succès / échec |

## Module 1 — Recherche & qualification de leads

Reprend la logique de `lead_agent.py` déjà écrit (fourni en pièce jointe), à porter en
Edge Function Supabase (TypeScript/Deno) ou à garder en Python appelé via une API séparée.

**Pipeline :**
1. Recherche Google Places (Maps) + Google Custom Search sur une requête donnée
2. Scraping du site web de chaque résultat : détecte HTTPS, présence de réservation en ligne,
   compatibilité mobile (balise viewport), extrait email/téléphone
3. Appel Claude pour qualifier : score 1-5, justification, **point clé factuel** (jamais inventé,
   basé uniquement sur les signaux détectés — voir prompt exact dans `lead_agent.py`)
4. Détermine le `service_cible` le plus pertinent selon le profil du lead (ex : pas de
   réservation en ligne → dashboard de suivi ; PME en croissance sans comptable → mise en avant
   du volet CEFCO/comptabilité)
5. Écriture dans Supabase (table `leads`), déduplication par nom + domaine du site web

## Module 2 — Génération & envoi d'emails

Reprend la logique de `send_agent.py` (fourni en pièce jointe).

**Règles de rédaction non négociables** (voir `voix-pierrot-SKILL.md` fourni en pièce jointe
pour le détail complet) :
- Écrire dans la voix réelle de Pierre-Olivier, jamais un style IA générique
- Interdits stricts : "n'hésitez pas à...", tirets cadratins (—) pour lister, transitions
  huilées ("de plus", "par ailleurs"), vocabulaire ronflant ("solutions innovantes",
  "sur-mesure"), répétition d'un même mot dans un email
- Le `point_cle` sert à choisir le sujet de l'email (stock, caisse, planning...) mais n'est
  JAMAIS cité comme une observation ("j'ai vu que...") — toujours formulé comme une réflexion
  humaine générale
- Message chaleureux mais jamais mielleux : accroche empathique, crédibilité par l'expérience
  vécue ("mon expérience en gestion opérationnelle et financière m'a permis de..."), CTA doux
  ("si ça vous intéresse, je serais content d'en discuter 15 minutes")
- **Preuve de crédibilité obligatoire** : chaque email doit inclure un lien ou une référence
  vérifiable (fynup-consulting.ch, ou une référence client visible comme L'Hair Tendance /
  Pâtisserie Vincent) — objectif : casser l'effet "je sors de nulle part", Pierrot est visible
  sur le web et les réseaux, l'email doit le montrer
- Lien vers la vidéo avatar générique inclus dans chaque email
- Adapter légèrement l'angle de l'email selon `service_cible` (dashboard / CEFCO / automatisation)

**Pipeline d'envoi :**
1. Lit les leads Supabase avec `score_ia >= seuil` et `statut_envoi = 'en_attente'`
2. Génère l'email via Claude (prompt détaillé dans `send_agent.py`)
3. Envoie via SMTP Infomaniak, délai aléatoire entre chaque envoi (60-180s, anti-spam)
4. Respecte une limite quotidienne configurable (30-50/jour recommandé)
5. Met à jour `statut_envoi` + `date_envoi`, enregistre le contenu dans `envois`

## Interface web (frontend)

### Écran 1 — Recherche
- Champ texte : requête de recherche (ex: "boulangeries Saint-Gall")
- Sélecteur : service à cibler en priorité (dashboard / CEFCO / automatisation / auto-détection)
- Nombre de résultats souhaité
- Bouton "Lancer la recherche" → déclenche le Module 1, affichage d'un état de chargement

### Écran 2 — Liste des leads
- Tableau : nom, score (avec code couleur), point clé, statut d'envoi, service ciblé
- Tri par score décroissant par défaut
- Filtre par score minimum, par statut, par service ciblé
- Sélection multiple (checkboxes) + "sélectionner tous les leads score ≥ X"
- Aperçu de l'email généré au clic sur un lead (avant envoi, pour validation manuelle possible)

### Écran 3 — Envoi
- Résumé : nombre de leads sélectionnés, limite quotidienne configurée
- Bouton "Lancer l'envoi" → déclenche le Module 2
- Suivi en temps réel : X/Y envoyés, succès/échecs
- Historique des envois passés (table `envois`)

## Points d'attention techniques

- **Rate limits** : Google Custom Search = 100 requêtes gratuites/jour ; Places API facturée à
  l'usage au-delà du crédit gratuit Google Cloud (200 CHF/mois)
- **SMTP Infomaniak** : nécessite un mot de passe applicatif (pas le mot de passe principal du
  compte) ; erreur fréquente "550 Relay denied" si mauvaise config — voir README fourni
- **Anti-spam** : ne jamais envoyer en rafale, toujours espacer les envois (déjà géré dans
  `send_agent.py`, à conserver dans le port Supabase)
- **Variables d'environnement nécessaires** : voir `.env.example` fourni en pièce jointe pour la
  liste complète (clés Google, Anthropic, Infomaniak, Supabase)

## Fichiers de référence fournis

- `lead_agent.py` — logique complète du module de recherche/qualification (Python, fonctionnel,
  à porter ou à appeler tel quel selon l'architecture choisie)
- `send_agent.py` — logique complète du module de génération/envoi d'emails
- `voix-pierrot-SKILL.md` — règles détaillées de la voix d'écriture à respecter dans tous les
  emails générés
- `.env.example` — liste des variables d'environnement et où les récupérer
- `README.md` — guide d'installation et d'utilisation de la version CLI actuelle

## Ordre de développement suggéré

1. Mettre en place le schéma Supabase (`leads` + `envois`)
2. Porter le Module 1 (recherche/qualification) et le brancher à l'écran 1 + écran 2
3. Valider manuellement la qualité des leads et des points clés sur quelques recherches réelles
4. Porter le Module 2 (génération/envoi) et le brancher à l'écran 3
5. Tester l'envoi sur un tout petit volume (2-3 leads) avant de monter en charge
6. Ajouter le suivi des réponses (lecture IMAP Infomaniak) en itération suivante — hors scope V1
