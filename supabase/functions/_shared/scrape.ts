// Scraping léger du site du lead — port de scrape_website() (lead_agent.py), sans dépendance DOM lourde.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const BOOKING_KEYWORDS = [
  "réserv", "reserv", "booking", "rendez-vous", "rdv", "prendre rendez", "book now", "calendly",
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

export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  if (!url) return { email: "", telephone: "", signaux_detectes: "" };

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const text = stripTags(html);
    const textLower = text.toLowerCase();
    const htmlLower = html.toLowerCase();

    const emailMatch = text.match(EMAIL_RE);
    const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);

    const hasBooking = BOOKING_KEYWORDS.some((kw) => textLower.includes(kw));
    const hasViewport = htmlLower.includes('name="viewport"');
    const isHttps = url.trim().toLowerCase().startsWith("https://");

    const signals: string[] = [];
    if (!isHttps) signals.push("site en HTTP non sécurisé (pas de cadenas HTTPS)");
    if (!hasBooking) signals.push("aucun système de réservation/prise de RDV en ligne visible");
    if (!hasViewport) signals.push("site probablement non optimisé mobile");

    return {
      email: emailMatch?.[0] ?? "",
      telephone: phoneMatch?.[0] ?? "",
      signaux_detectes: signals.join("; "),
    };
  } catch {
    return { email: "", telephone: "", signaux_detectes: "site inaccessible ou inexistant" };
  }
}
