// Google Custom Search (recherche web) + Google Places (Maps) — port direct de lead_agent.py.

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") ?? "";
const GOOGLE_CSE_ID = Deno.env.get("GOOGLE_CSE_ID") ?? "";

export interface SearchItem {
  title: string;
  link: string;
  snippet: string;
}

export async function googleSearch(query: string, num: number): Promise<SearchItem[]> {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) return [];

  const results: SearchItem[] = [];
  for (let start = 1; start <= num; start += 10) {
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CSE_ID,
      q: query,
      start: String(start),
      num: String(Math.min(10, num - start + 1)),
    });
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
    if (!res.ok) break;
    const data = await res.json();
    for (const item of data.items ?? []) {
      results.push({ title: item.title ?? "", link: item.link ?? "", snippet: item.snippet ?? "" });
    }
    if (!data.items) break;
  }
  return results;
}

export interface PlaceResult {
  nom: string;
  adresse: string;
  note_google: string;
  site_web: string;
  telephone: string;
}

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const params = new URLSearchParams({ address: query, key: GOOGLE_API_KEY });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

async function placeDetails(placeId: string): Promise<{ phone: string; website: string }> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: "formatted_phone_number,website",
    key: GOOGLE_API_KEY,
  });
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    if (!res.ok) return { phone: "", website: "" };
    const data = await res.json();
    return {
      phone: data.result?.formatted_phone_number ?? "",
      website: data.result?.website ?? "",
    };
  } catch {
    return { phone: "", website: "" };
  }
}

export async function googlePlacesSearch(
  query: string,
  maxResults: number,
  radiusKm = 20,
): Promise<PlaceResult[]> {
  if (!GOOGLE_API_KEY) return [];

  // Géocode la requête (ville tapée par l'utilisateur, ex: "salon de coiffure Penthalaz") pour
  // borner la recherche à un rayon raisonnable autour d'elle — sans ça, Text Search peut
  // remonter des résultats n'importe où en Suisse (voire hors Suisse) sur un simple match texte.
  const center = await geocode(query);

  const places: PlaceResult[] = [];
  let pageToken: string | undefined;

  while (places.length < maxResults) {
    const params = new URLSearchParams({ query, key: GOOGLE_API_KEY });
    if (center) {
      params.set("location", `${center.lat},${center.lng}`);
      params.set("radius", String(Math.round(radiusKm * 1000)));
    }
    if (pageToken) {
      params.set("pagetoken", pageToken);
      await new Promise((r) => setTimeout(r, 2000)); // Google exige un court délai avant d'utiliser un page token
    }
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
    if (!res.ok) break;
    const data = await res.json();

    for (const result of data.results ?? []) {
      const detail = result.place_id ? await placeDetails(result.place_id) : { phone: "", website: "" };
      places.push({
        nom: result.name ?? "",
        adresse: result.formatted_address ?? "",
        note_google: result.rating !== undefined ? String(result.rating) : "",
        site_web: detail.website,
        telephone: detail.phone,
      });
      if (places.length >= maxResults) break;
    }

    pageToken = data.next_page_token;
    if (!pageToken) break;
  }

  return places;
}
