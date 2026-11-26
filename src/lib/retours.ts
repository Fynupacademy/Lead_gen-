import type { Lead } from "./types";

// Page de réservation Cal.com de FynUp (publique). Si elle est vide, les boutons Cal.com ne
// s'affichent pas.
export const CAL_LINK: string = "https://cal.com/fynup-consulting";

export type TypeRetour = "renseignement" | "rdv" | "demo" | "pas_interesse" | "ne_plus_contacter";

export const RETOUR_ORDER: TypeRetour[] = ["renseignement", "rdv", "demo", "pas_interesse", "ne_plus_contacter"];

export const RETOUR_LABELS: Record<TypeRetour, string> = {
  renseignement: "Demande de renseignement",
  rdv: "Demande de rendez-vous",
  demo: "Demande de démonstration",
  pas_interesse: "Pas intéressé",
  ne_plus_contacter: "Ne plus contacter",
};

export const RETOUR_STYLES: Record<TypeRetour, { bar: string; pill: string }> = {
  renseignement: { bar: "bg-fyn", pill: "bg-fyn-light text-fyn-dark" },
  rdv: { bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700" },
  demo: { bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700" },
  pas_interesse: { bar: "bg-neutral-400", pill: "bg-neutral-100 text-neutral-600" },
  ne_plus_contacter: { bar: "bg-red-600", pill: "bg-red-50 text-red-700" },
};

// Retours qui ouvrent une suite commerciale.
export function isPositive(type: TypeRetour | null | undefined): boolean {
  return type === "renseignement" || type === "rdv" || type === "demo";
}

export function hasDate(type: TypeRetour | "" | null): boolean {
  return type === "rdv" || type === "demo";
}

// Adresses des leads « ne plus contacter » : aucun envoi ne doit repartir vers elles, même via un
// autre lead portant la même adresse.
export function blockedEmails(leads: Pick<Lead, "email" | "type_retour">[]): Set<string> {
  return new Set(
    leads.filter((l) => l.type_retour === "ne_plus_contacter" && l.email).map((l) => l.email.toLowerCase()),
  );
}

export function isBlocked(lead: Pick<Lead, "email" | "type_retour">, blocked: Set<string>): boolean {
  return lead.type_retour === "ne_plus_contacter" || (!!lead.email && blocked.has(lead.email.toLowerCase()));
}

// Page Cal.com pré-remplie avec le nom et l'email du prospect.
export function calBookingUrl(lead: Pick<Lead, "nom" | "email">): string {
  const url = new URL(CAL_LINK);
  url.searchParams.set("name", lead.nom);
  if (lead.email) url.searchParams.set("email", lead.email);
  return url.toString();
}
