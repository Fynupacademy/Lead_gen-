#!/usr/bin/env python3
"""
Agent de lead generation FynUp
==============================
Pipeline : Google Search + Google Maps (Places) -> scraping site web ->
qualification IA (Claude) -> écriture dans Google Sheets, sans doublon.

USAGE
-----
    python lead_agent.py --query "boulangeries Saint-Gall" --max-results 20

CONFIGURATION (variables d'environnement ou fichier .env)
-----------------------------------------------------------
    GOOGLE_API_KEY          -> clé API Google Cloud (Custom Search + Places)
    GOOGLE_CSE_ID           -> ID du moteur Custom Search (cse.google.com)
    ANTHROPIC_API_KEY       -> clé API Claude (console.anthropic.com)
    GOOGLE_SHEETS_CREDS     -> chemin vers le fichier JSON du compte de service
    GOOGLE_SHEET_ID         -> ID de la Google Sheet cible

DÉPENDANCES
-----------
    pip install requests beautifulsoup4 anthropic gspread google-auth python-dotenv
"""

import os
import re
import sys
import time
import argparse
import logging
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

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
log = logging.getLogger("lead_agent")

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_SHEETS_CREDS = os.getenv("GOOGLE_SHEETS_CREDS", "credentials.json")
GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "")

SHEET_HEADERS = [
    "nom", "email", "telephone", "site_web", "adresse",
    "note_google", "score_ia", "justification_ia", "point_cle", "source_requete",
]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(\+?\d[\d\s().\-]{7,}\d)")


# --------------------------------------------------------------------------
# Modèle de données
# --------------------------------------------------------------------------

@dataclass
class Lead:
    nom: str
    email: str = ""
    telephone: str = ""
    site_web: str = ""
    adresse: str = ""
    note_google: str = ""
    score_ia: str = ""
    justification_ia: str = ""
    point_cle: str = ""
    signaux_detectes: str = ""
    source_requete: str = ""

    def as_row(self) -> list:
        return [
            self.nom, self.email, self.telephone, self.site_web,
            self.adresse, self.note_google, self.score_ia,
            self.justification_ia, self.point_cle, self.source_requete,
        ]


# --------------------------------------------------------------------------
# Étape 1 : Google Custom Search (résultats web)
# --------------------------------------------------------------------------

def google_search(query: str, num: int = 10) -> list[dict]:
    """Interroge Google Custom Search API. Renvoie une liste de {title, link, snippet}."""
    if not GOOGLE_API_KEY or not GOOGLE_CSE_ID:
        log.warning("GOOGLE_API_KEY / GOOGLE_CSE_ID manquants — étape Search ignorée.")
        return []

    results = []
    url = "https://www.googleapis.com/customsearch/v1"
    for start in range(1, num + 1, 10):
        params = {
            "key": GOOGLE_API_KEY,
            "cx": GOOGLE_CSE_ID,
            "q": query,
            "start": start,
            "num": min(10, num - start + 1),
        }
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            data = r.json()
        except requests.RequestException as e:
            log.error(f"Erreur Google Search: {e}")
            break

        for item in data.get("items", []):
            results.append({
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            })
        if "items" not in data:
            break
    log.info(f"Google Search: {len(results)} résultats pour '{query}'")
    return results


# --------------------------------------------------------------------------
# Étape 2 : Google Places (Google Maps) — enrichissement local
# --------------------------------------------------------------------------

def google_places_search(query: str, max_results: int = 20) -> list[dict]:
    """Interroge Google Places Text Search API. Renvoie nom, adresse, tel, note, site."""
    if not GOOGLE_API_KEY:
        log.warning("GOOGLE_API_KEY manquant — étape Places ignorée.")
        return []

    places = []
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "key": GOOGLE_API_KEY}
    next_token = None

    while len(places) < max_results:
        if next_token:
            params["pagetoken"] = next_token
            time.sleep(2)  # Google exige un court délai avant d'utiliser un page token
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            data = r.json()
        except requests.RequestException as e:
            log.error(f"Erreur Google Places: {e}")
            break

        for result in data.get("results", []):
            place_id = result.get("place_id")
            detail = google_place_details(place_id) if place_id else {}
            places.append({
                "nom": result.get("name", ""),
                "adresse": result.get("formatted_address", ""),
                "note_google": str(result.get("rating", "")),
                "site_web": detail.get("website", ""),
                "telephone": detail.get("phone", ""),
            })
            if len(places) >= max_results:
                break

        next_token = data.get("next_page_token")
        if not next_token:
            break

    log.info(f"Google Places: {len(places)} établissements pour '{query}'")
    return places


def google_place_details(place_id: str) -> dict:
    """Récupère téléphone + site web via Place Details API."""
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "formatted_phone_number,website",
        "key": GOOGLE_API_KEY,
    }
    try:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        result = r.json().get("result", {})
        return {
            "phone": result.get("formatted_phone_number", ""),
            "website": result.get("website", ""),
        }
    except requests.RequestException:
        return {}


# --------------------------------------------------------------------------
# Étape 3 : scraping du site web pour email / infos manquantes
# --------------------------------------------------------------------------

BOOKING_KEYWORDS = ["réserv", "booking", "rendez-vous", "rdv", "prendre rendez", "book now", "calendly"]


def scrape_website(url: str) -> dict:
    """Visite un site, extrait email/téléphone, et détecte des signaux concrets
    exploitables comme point clé d'accroche (HTTPS, réservation en ligne, mobile)."""
    if not url:
        return {}
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        text = soup.get_text(" ", strip=True)
        text_lower = text.lower()
        html_lower = r.text.lower()

        emails = EMAIL_RE.findall(text)
        phones = PHONE_RE.findall(text)

        has_booking = any(kw in text_lower for kw in BOOKING_KEYWORDS)
        has_viewport = 'name="viewport"' in html_lower  # signal basique de compatibilité mobile
        is_https = url.strip().lower().startswith("https://")

        signals = []
        if not is_https:
            signals.append("site en HTTP non sécurisé (pas de cadenas HTTPS)")
        if not has_booking:
            signals.append("aucun système de réservation/prise de RDV en ligne visible")
        if not has_viewport:
            signals.append("site probablement non optimisé mobile")

        return {
            "email": emails[0] if emails else "",
            "telephone": phones[0] if phones else "",
            "signaux_detectes": "; ".join(signals),
        }
    except requests.RequestException as e:
        log.debug(f"Scraping échoué pour {url}: {e}")
        return {"signaux_detectes": "site inaccessible ou inexistant"}


# --------------------------------------------------------------------------
# Étape 4 : qualification IA (Claude) — score + justification
# --------------------------------------------------------------------------

def qualify_lead_with_ai(lead: Lead, icp_description: str) -> tuple[str, str, str]:
    """
    Appelle Claude pour scorer le lead par rapport à l'ICP défini,
    et génère un "point clé" — accroche factuelle et vérifiable pour l'email.
    Renvoie (score, justification, point_cle).
    """
    if not ANTHROPIC_API_KEY:
        log.warning("ANTHROPIC_API_KEY manquant — qualification IA ignorée.")
        return "", "", ""

    try:
        import anthropic
    except ImportError:
        log.error("Le package 'anthropic' n'est pas installé (pip install anthropic).")
        return "", "", ""

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Tu es un agent de qualification de leads B2B pour FynUp Consulting
(cabinet suisse romand de digitalisation pour PME : dashboards, automatisation, IA).

ICP cible : {icp_description}

Lead à évaluer :
- Nom : {lead.nom}
- Adresse : {lead.adresse}
- Site web : {lead.site_web or "aucun site trouvé"}
- Email trouvé : {lead.email or "aucun"}
- Note Google : {lead.note_google or "n/a"}
- Signaux détectés sur le site : {lead.signaux_detectes or "aucun signal collecté"}

Trois choses à produire :

1. SCORE (1 à 5) : fit avec l'ICP.

2. JUSTIFICATION : une phrase sur pourquoi ce score.

3. POINT_CLE : une accroche FACTUELLE et VÉRIFIABLE à utiliser en ouverture d'un email
   de prospection. Règles strictes :
   - Doit s'appuyer sur un signal réel listé ci-dessus (pas d'invention).
   - Doit être spécifique à CE lead, pas une généralité applicable à n'importe qui.
   - Formulée comme une observation neutre, jamais un reproche.
   - Si aucun signal exploitable n'est disponible, écris "aucun point clé fiable disponible"
     plutôt que d'inventer.

Réponds STRICTEMENT au format :
SCORE: <chiffre>
JUSTIFICATION: <une phrase>
POINT_CLE: <une phrase factuelle et vérifiable, ou "aucun point clé fiable disponible">"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=250,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()

        score_match = re.search(r"SCORE:\s*(\d)", text)
        just_match = re.search(r"JUSTIFICATION:\s*(.+)", text)
        point_cle_match = re.search(r"POINT_CLE:\s*(.+)", text)

        score = score_match.group(1) if score_match else ""
        justification = just_match.group(1).strip() if just_match else ""
        point_cle = point_cle_match.group(1).strip() if point_cle_match else ""

        return score, justification, point_cle
    except Exception as e:
        log.error(f"Erreur qualification IA: {e}")
        return "", "", ""


# --------------------------------------------------------------------------
# Étape 5 : écriture dans Google Sheets (sans doublon)
# --------------------------------------------------------------------------

def get_sheet():
    """Ouvre la Google Sheet cible via compte de service. Crée l'entête si besoin."""
    import gspread
    from google.oauth2.service_account import Credentials

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_file(GOOGLE_SHEETS_CREDS, scopes=scopes)
    gc = gspread.authorize(creds)
    sheet = gc.open_by_key(GOOGLE_SHEET_ID).sheet1

    if not sheet.row_values(1):
        sheet.append_row(SHEET_HEADERS)

    return sheet


def get_existing_names(sheet) -> set[str]:
    """Récupère les noms déjà présents pour éviter les doublons."""
    try:
        col = sheet.col_values(1)[1:]  # colonne "nom", sans l'en-tête
        return set(n.strip().lower() for n in col)
    except Exception:
        return set()


def write_leads_to_sheet(leads: list[Lead]):
    if not GOOGLE_SHEET_ID:
        log.warning("GOOGLE_SHEET_ID manquant — écriture Sheets ignorée. Export CSV local à la place.")
        write_leads_to_csv(leads)
        return

    try:
        sheet = get_sheet()
    except Exception as e:
        log.error(f"Impossible d'ouvrir la Google Sheet ({e}) — export CSV local à la place.")
        write_leads_to_csv(leads)
        return

    existing = get_existing_names(sheet)
    new_rows = [l.as_row() for l in leads if l.nom.strip().lower() not in existing]

    if new_rows:
        sheet.append_rows(new_rows)
        log.info(f"{len(new_rows)} nouveaux leads ajoutés à la Sheet (doublons ignorés: {len(leads) - len(new_rows)}).")
    else:
        log.info("Aucun nouveau lead à ajouter (tous déjà présents).")


def write_leads_to_csv(leads: list[Lead], path: str = "leads_export.csv"):
    import csv
    filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(SHEET_HEADERS)
        for l in leads:
            writer.writerow(l.as_row())
    log.info(f"Export CSV écrit: {filepath}")


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def run(query: str, max_results: int, icp: str, use_maps: bool = True, use_search: bool = True):
    log.info(f"Lancement de l'agent pour la requête: '{query}'")
    leads: list[Lead] = []

    if use_maps:
        for place in google_places_search(query, max_results=max_results):
            lead = Lead(
                nom=place["nom"],
                adresse=place["adresse"],
                site_web=place["site_web"],
                telephone=place["telephone"],
                note_google=place["note_google"],
                source_requete=query,
            )
            leads.append(lead)

    if use_search:
        for item in google_search(query, num=max_results):
            nom = item["title"].split(" - ")[0].split(" | ")[0]
            if any(l.nom.lower() == nom.lower() for l in leads):
                continue
            leads.append(Lead(nom=nom, site_web=item["link"], source_requete=query))

    log.info(f"{len(leads)} leads bruts collectés. Scraping des sites en cours...")

    for lead in leads:
        if lead.site_web:
            info = scrape_website(lead.site_web)
            lead.email = lead.email or info.get("email", "")
            lead.telephone = lead.telephone or info.get("telephone", "")
            lead.signaux_detectes = info.get("signaux_detectes", "")

    log.info("Qualification IA en cours...")
    for lead in leads:
        score, justification, point_cle = qualify_lead_with_ai(lead, icp)
        lead.score_ia = score
        lead.justification_ia = justification
        lead.point_cle = point_cle

    # Trie les meilleurs leads en premier
    leads.sort(key=lambda l: l.score_ia or "0", reverse=True)

    log.info("Écriture dans Google Sheets...")
    write_leads_to_sheet(leads)

    log.info("Terminé.")
    return leads


def main():
    parser = argparse.ArgumentParser(description="Agent de lead generation FynUp")
    parser.add_argument("--query", required=True, help="Requête de recherche, ex: 'boulangeries Saint-Gall'")
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument(
        "--icp",
        default="Petites entreprises et indépendants suisses romands, surchargés, sans outil digital structuré (pas de dashboard, pas de CRM, gestion manuelle)",
        help="Description de l'ICP pour la qualification IA",
    )
    parser.add_argument("--no-maps", action="store_true", help="Désactive la recherche Google Maps")
    parser.add_argument("--no-search", action="store_true", help="Désactive la recherche Google Search")
    args = parser.parse_args()

    leads = run(
        query=args.query,
        max_results=args.max_results,
        icp=args.icp,
        use_maps=not args.no_maps,
        use_search=not args.no_search,
    )

    print(f"\n{'='*60}")
    print(f"RÉSUMÉ : {len(leads)} leads traités pour '{args.query}'")
    print(f"{'='*60}")
    for l in leads[:10]:
        email_display = l.email or "pas d'email"
        print(f"[{l.score_ia or '?'}/5] {l.nom} — {email_display} — {l.justification_ia}")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        print(__doc__)
        sys.exit(0)
    main()
