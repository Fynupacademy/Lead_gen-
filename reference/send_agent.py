#!/usr/bin/env python3
"""
Module d'envoi FynUp — cold email personnalisé + vidéo avatar
================================================================
Lit les leads qualifiés dans la Google Sheet, génère un email personnalisé
via Claude, l'envoie via SMTP Infomaniak avec le lien vers la vidéo générique,
respecte la cadence quotidienne, et marque le statut d'envoi (sans doublon).

USAGE
-----
    python send_agent.py --daily-limit 40 --min-score 3

CONFIGURATION (.env, en plus des clés de lead_agent.py)
---------------------------------------------------------
    INFOMANIAK_EMAIL        -> ton adresse complète (ex: pierrot@fynup-consulting.ch)
    INFOMANIAK_PASSWORD     -> mot de passe Infomaniak (ou mot de passe applicatif)
    INFOMANIAK_SMTP_HOST    -> mail.infomaniak.com (par défaut)
    INFOMANIAK_SMTP_PORT    -> 587 (TLS, par défaut)
    VIDEO_URL               -> lien vers ta vidéo avatar générique
    SENDER_NAME             -> nom affiché à l'envoi (ex: "Pierre-Olivier - FynUp Consulting")

DÉPENDANCES
-----------
    pip install anthropic gspread google-auth python-dotenv
    (smtplib est natif à Python, pas besoin de l'installer)
"""

import os
import time
import random
import argparse
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("send_agent")

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_SHEETS_CREDS = os.getenv("GOOGLE_SHEETS_CREDS", "credentials.json")
GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "")

INFOMANIAK_EMAIL = os.getenv("INFOMANIAK_EMAIL", "")
INFOMANIAK_PASSWORD = os.getenv("INFOMANIAK_PASSWORD", "")
INFOMANIAK_SMTP_HOST = os.getenv("INFOMANIAK_SMTP_HOST", "mail.infomaniak.com")
INFOMANIAK_SMTP_PORT = int(os.getenv("INFOMANIAK_SMTP_PORT", "587"))

VIDEO_URL = os.getenv("VIDEO_URL", "")
SENDER_NAME = os.getenv("SENDER_NAME", "FynUp Consulting")

# Colonnes attendues dans la Sheet (générées par lead_agent.py + colonnes ajoutées ici)
COL_NOM = "nom"
COL_EMAIL = "email"
COL_SCORE = "score_ia"
COL_JUSTIFICATION = "justification_ia"
COL_POINT_CLE = "point_cle"
COL_STATUT = "statut_envoi"       # sera créée si absente
COL_DATE_ENVOI = "date_envoi"     # sera créée si absente

EMAIL_TEMPLATE_PROMPT = """Tu rédiges un email de prospection à froid pour FynUp Consulting,
un cabinet suisse romand de digitalisation pour PME (dashboards, automatisation, IA).

Contexte sur le destinataire :
- Nom de l'entreprise : {nom}
- Secteur / activité probable : {secteur}
- Point clé factuel (sert à choisir le bon sujet, ne jamais le citer comme observation) : {point_cle}

STYLE À SUIVRE — chaleureux, sympa, engageant. Pas robotique, pas mielleux non plus.

1. Salutation naturelle et humaine : "Bonjour [nom entreprise ou prénom si connu]," — jamais un
   "Bonjour," sec et générique.

2. Présentation courte de Pierre-Olivier AVANT de parler du lead, ancrée dans l'expérience
   VÉCUE, jamais une promesse de résultat futur. INTERDIT : "je garantis", "vous obtiendrez",
   "résultats rapides et concrets". À la place : "Mon expérience en gestion opérationnelle et
   financière m'a
   permis d'accompagner des indépendants qui..." — une formulation au passé, factuelle.

3. Le lien avec leur activité doit sonner comme une réflexion humaine, jamais une analyse
   robotique. INTERDIT : "j'ai remarqué que...", "j'ai vu que votre site...", "j'ai analysé...".
   Le point clé ({point_cle}) sert en coulisses à choisir le bon sujet (stock, caisse,
   planning...), jamais affiché comme une preuve d'observation.

4. Message central : le temps qui manque toujours, et la clarté financière (voir simplement où
   on gagne et où on perd de l'argent). Introduis ça avec une phrase d'empathie/complicité qui
   montre que tu comprends leur quotidien de l'intérieur. Exemple d'esprit (à adapter, jamais
   recopier tel quel) : "On voit souvent la même chose chez les indépendants : le métier tourne
   bien, mais les chiffres et le temps filent entre les doigts."

5. Hyper court, direct, aucune formule ronflante ("révolutionnaire", "solution sur-mesure",
   "transformez votre entreprise"). Écris comme on parle. Chaleureux ne veut pas dire mielleux :
   pas de superlatifs sur la personne/l'entreprise, pas de flatterie non méritée.

6. Termine par une phrase simple qui amène vers la vidéo de 8 secondes.

7. CTA final : adouci, jamais pressant. Formulation du type "si ça vous intéresse, je serais
   content d'en discuter 15 minutes" plutôt qu'une demande sèche de créneau.

8. Clôture humaine avant la signature : une phrase courte qui montre que c'est une vraie
   personne qui écrit, pas juste "Cordialement".

9. 6-7 phrases MAXIMUM au total (hors signature).

10. INTERDIT ABSOLU — vérifie avant de répondre : aucun mot ne doit se répéter dans le texte
    (sauf mots-outils indispensables et noms propres). Si un mot te vient naturellement deux
    fois, reformule une des deux occurrences.

11. INTERDIT ABSOLU — bannis ces tics typiques de texte généré par IA :
    - "N'hésitez pas à..."
    - "Je reste à votre disposition" / "disponible pour toute question"
    - Phrases toutes de longueur similaire (varie le rythme)
    - Tirets cadratins (—) utilisés plus d'une fois dans le texte
    - Transitions huilées : "De plus", "Par ailleurs", "En outre"
    - Toute formule déjà utilisée dans une phrase précédente du même email

12. Signe "Pierre-Olivier, FynUp Consulting".

Réponds uniquement avec le texte de l'email, rien d'autre."""


# --------------------------------------------------------------------------
# Génération du texte personnalisé (Claude)
# --------------------------------------------------------------------------

def generate_email_body(nom: str, point_cle: str, secteur: str = "") -> str:
    if not ANTHROPIC_API_KEY:
        log.warning("ANTHROPIC_API_KEY manquant — utilisation d'un template générique.")
        return default_email_body(nom)

    try:
        import anthropic
    except ImportError:
        log.error("Package 'anthropic' manquant (pip install anthropic).")
        return default_email_body(nom)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = EMAIL_TEMPLATE_PROMPT.format(
        nom=nom,
        secteur=secteur or "non précisé",
        point_cle=point_cle or "aucun point clé fiable disponible",
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        body = response.content[0].text.strip()
        if VIDEO_URL and VIDEO_URL not in body:
            body += f"\n\nVoici 8 secondes qui résument l'idée : {VIDEO_URL}"
        return body
    except Exception as e:
        log.error(f"Erreur génération email pour {nom}: {e}")
        return default_email_body(nom)


def default_email_body(nom: str) -> str:
    """Fallback si l'IA échoue — évite de bloquer tout l'envoi, garde le ton chaleureux."""
    video_line = f"\n\nVoici 8 secondes qui résument l'idée : {VIDEO_URL}" if VIDEO_URL else ""
    return (
        f"Bonjour {nom},\n\n"
        f"Je suis Pierre-Olivier, de FynUp Consulting. Mon expérience en gestion opérationnelle "
        f"et financière "
        f"m'a permis d'accompagner des indépendants qui, comme vous, jonglent avec le métier et "
        f"les chiffres en même temps.\n"
        f"On voit souvent la même chose : le métier tourne bien, mais le temps et la clarté sur "
        f"les chiffres filent entre les doigts.{video_line}\n\n"
        f"Si ça vous intéresse, je serais content d'en discuter 15 minutes.\n\n"
        f"Bonne continuation dans tout ce que vous menez,\n"
        f"Pierre-Olivier, FynUp Consulting"
    )


# --------------------------------------------------------------------------
# Envoi SMTP Infomaniak
# --------------------------------------------------------------------------

def send_email(to_email: str, subject: str, body: str) -> bool:
    if not INFOMANIAK_EMAIL or not INFOMANIAK_PASSWORD:
        log.error("INFOMANIAK_EMAIL / INFOMANIAK_PASSWORD manquants — envoi impossible.")
        return False

    msg = MIMEMultipart()
    msg["From"] = f"{SENDER_NAME} <{INFOMANIAK_EMAIL}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP(INFOMANIAK_SMTP_HOST, INFOMANIAK_SMTP_PORT, timeout=20) as server:
            server.starttls()
            server.login(INFOMANIAK_EMAIL, INFOMANIAK_PASSWORD)
            server.sendmail(INFOMANIAK_EMAIL, to_email, msg.as_string())
        return True
    except smtplib.SMTPAuthenticationError:
        log.error("Échec d'authentification Infomaniak — vérifie email/mot de passe (ou utilise un mot de passe applicatif).")
        return False
    except smtplib.SMTPRecipientsRefused:
        log.error(f"Adresse refusée par le serveur: {to_email}")
        return False
    except Exception as e:
        log.error(f"Erreur SMTP pour {to_email} (souvent '550 Relay denied' chez Infomaniak — voir README): {e}")
        return False


# --------------------------------------------------------------------------
# Google Sheets — lecture des leads + mise à jour du statut
# --------------------------------------------------------------------------

def get_sheet():
    import gspread
    from google.oauth2.service_account import Credentials

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_file(GOOGLE_SHEETS_CREDS, scopes=scopes)
    gc = gspread.authorize(creds)
    return gc.open_by_key(GOOGLE_SHEET_ID).sheet1


def ensure_tracking_columns(sheet, headers: list) -> dict:
    """Ajoute les colonnes de suivi si absentes. Renvoie un dict {nom_colonne: index (1-based)}."""
    changed = False
    if COL_STATUT not in headers:
        headers.append(COL_STATUT)
        changed = True
    if COL_DATE_ENVOI not in headers:
        headers.append(COL_DATE_ENVOI)
        changed = True
    if changed:
        sheet.update("A1", [headers])
    return {h: i + 1 for i, h in enumerate(headers)}


def get_pending_leads(sheet, min_score: int) -> list[dict]:
    """Renvoie les leads avec score >= min_score et pas encore marqués 'envoyé'."""
    records = sheet.get_all_records()
    headers = sheet.row_values(1)
    col_index = ensure_tracking_columns(sheet, headers)

    pending = []
    for i, row in enumerate(records, start=2):  # ligne 1 = en-tête
        score = row.get(COL_SCORE, "")
        statut = row.get(COL_STATUT, "")
        email = row.get(COL_EMAIL, "")

        try:
            score_val = int(score)
        except (ValueError, TypeError):
            score_val = 0

        if email and score_val >= min_score and statut != "envoyé":
            row["_row_number"] = i
            pending.append(row)

    return pending, col_index


def mark_as_sent(sheet, row_number: int, col_index: dict):
    sheet.update_cell(row_number, col_index[COL_STATUT], "envoyé")
    sheet.update_cell(row_number, col_index[COL_DATE_ENVOI], datetime.now().strftime("%Y-%m-%d %H:%M"))


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def run(daily_limit: int, min_score: int, delay_range: tuple[int, int] = (60, 180)):
    if not GOOGLE_SHEET_ID:
        log.error("GOOGLE_SHEET_ID manquant — impossible de lire les leads.")
        return

    sheet = get_sheet()
    pending, col_index = get_pending_leads(sheet, min_score=min_score)

    log.info(f"{len(pending)} leads en attente d'envoi (score >= {min_score}).")

    to_send = pending[:daily_limit]
    if not to_send:
        log.info("Rien à envoyer aujourd'hui.")
        return

    log.info(f"Envoi de {len(to_send)} emails aujourd'hui (limite: {daily_limit}/jour).")

    sent_count = 0
    for lead in to_send:
        nom = lead.get(COL_NOM, "")
        email = lead.get(COL_EMAIL, "")
        point_cle = lead.get(COL_POINT_CLE, "")
        secteur = lead.get("source_requete", "")
        row_number = lead["_row_number"]

        body = generate_email_body(nom, point_cle, secteur)
        subject = f"Une idée pour {nom}"

        log.info(f"Envoi à {nom} <{email}>...")
        success = send_email(email, subject, body)

        if success:
            mark_as_sent(sheet, row_number, col_index)
            sent_count += 1
            log.info(f"✓ Envoyé à {nom}")
        else:
            log.warning(f"✗ Échec pour {nom} — sera retenté au prochain lancement.")

        # Espacement aléatoire entre les envois pour éviter les filtres anti-spam
        if lead != to_send[-1]:
            wait = random.randint(*delay_range)
            log.info(f"Attente de {wait}s avant le prochain envoi...")
            time.sleep(wait)

    log.info(f"Terminé : {sent_count}/{len(to_send)} emails envoyés avec succès.")


def main():
    parser = argparse.ArgumentParser(description="Module d'envoi FynUp — cold email personnalisé")
    parser.add_argument("--daily-limit", type=int, default=40, help="Nombre max d'emails à envoyer aujourd'hui")
    parser.add_argument("--min-score", type=int, default=3, help="Score IA minimum pour envoyer (1-5)")
    parser.add_argument("--min-delay", type=int, default=60, help="Délai minimum entre 2 envois (secondes)")
    parser.add_argument("--max-delay", type=int, default=180, help="Délai maximum entre 2 envois (secondes)")
    args = parser.parse_args()

    run(
        daily_limit=args.daily_limit,
        min_score=args.min_score,
        delay_range=(args.min_delay, args.max_delay),
    )


if __name__ == "__main__":
    main()
