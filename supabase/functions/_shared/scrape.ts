// Scraping léger du site du lead — port de scrape_website() (lead_agent.py), sans dépendance DOM lourde.
// Si l'email n'est pas trouvé sur la page d'accueil, tente quelques pages de contact usuelles
// avant d'abandonner (beaucoup de sites n'affichent l'email que sur /contact ou /mentions-legales).

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const BOOKING_KEYWORDS = [
  "réserv", "reserv", "booking", "rendez-vous", "rdv", "prendre rendez", "book now", "calendly",
];
const CONTACT_PATHS = [
  "/contact", "/contact-us", "/nous-contacter", "/contactez-nous", "/mentions-legales", "/impressum", "/kontakt",
];

export interface ScrapeResult {
  email: string;
  telephone: string;
  signaux_detectes: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmail(html: string, text: string): string {
  // Un email en lien "mailto:" (souvent caché derrière une icône, sans texte visible) compte
  // autant qu'un email affiché en clair.
  const mailtoMatch = html.match(/mailto:([^"'\s?>]+)/i);
  if (mailtoMatch) {
    try {
      return decodeURIComponent(mailtoMatch[1]);
    } catch {
      return mailtoMatch[1];
    }
  }
  return text.match(EMAIL_RE)?.[0] ?? "";
}

async function fetchPage(url: string, timeoutMs: number): Promise<{ html: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { html, text: stripTags(html) };
  } catch {
    return null;
  }
}

export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  if (!url) return { email: "", telephone: "", signaux_detectes: "" };

  const home = await fetchPage(url, 10000);
  if (!home) {
    return { email: "", telephone: "", signaux_detectes: "site inaccessible ou inexistant" };
  }

  const { html, text } = home;
  const textLower = text.toLowerCase();
  const htmlLower = html.toLowerCase();

  let email = extractEmail(html, text);
  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);

  if (!email) {
    try {
      const base = new URL(url);
      for (const path of CONTACT_PATHS) {
        const sub = await fetchPage(new URL(path, base).toString(), 5000);
        if (sub) {
          email = extractEmail(sub.html, sub.text);
          if (email) break;
        }
      }
    } catch {
      // URL de base invalide — on garde les résultats de la page d'accueil tels quels.
    }
  }

  const hasBooking = BOOKING_KEYWORDS.some((kw) => textLower.includes(kw));
  const hasViewport = htmlLower.includes('name="viewport"');
  const isHttps = url.trim().toLowerCase().startsWith("https://");

  const signals: string[] = [];
  if (!isHttps) signals.push("site en HTTP non sécurisé (pas de cadenas HTTPS)");
  if (!hasBooking) signals.push("aucun système de réservation/prise de RDV en ligne visible");
  if (!hasViewport) signals.push("site probablement non optimisé mobile");

  return {
    email,
    telephone: phoneMatch?.[0] ?? "",
    signaux_detectes: signals.join("; "),
  };
}
