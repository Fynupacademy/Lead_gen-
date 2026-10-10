// Module 1 — recherche & qualification de leads. Port de lead_agent.py en Edge Function.
// POST { query: string, maxResults?: number, icp?: string, useMaps?: boolean, useSearch?: boolean }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { googlePlacesSearch, googleSearch } from "../_shared/google.ts";
import { scrapeWebsite } from "../_shared/scrape.ts";
import { qualifyLead } from "../_shared/qualify.ts";
import { normalizeDomain, type LeadRow } from "../_shared/types.ts";

const DEFAULT_ICP = `Indépendants et petites entreprises de Suisse romande (1 à 15 personnes), dans quatre secteurs : bâtiment (peintre, sanitaire, carreleur, électricien, maçon, menuisier, plâtrier), commerce alimentaire (boulangerie, boucherie, épicerie, fromagerie), coiffure et beauté (salon, institut, esthétique), restauration (restaurant, café, traiteur, bar).

Profil idéal : entreprise locale en activité réelle (note Google présente, avis récents), dirigée par son propriétaire, dont la gestion semble encore manuelle : devis et factures sur papier ou Excel, suivi du chiffre d'affaires et des marges sans outil, pas de prise de rendez-vous ou de commande en ligne.

Bon indice (score élevé) : une adresse email directe, un site simple ou ancien (pas de réservation, pas de devis en ligne, pas de HTTPS), une petite structure visible (équipe réduite, une seule adresse).
Mauvais indice (score bas) : chaîne, franchise ou grande enseigne, plus de 20 personnes, site avec outils de gestion déjà intégrés (boutique ou réservation en ligne avancée), entreprise hors Suisse romande, fiche abandonnée ou sans aucune activité visible.

Barème : 5 = secteur cible, petite structure, gestion clairement manuelle, email disponible. 4 = secteur cible et petite structure, mais peu de signaux sur la gestion. 3 = secteur cible mais taille ou besoin incertains. 2 = hors secteur cible ou probablement trop structuré. 1 = chaîne, franchise, grande entreprise ou hors zone.`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const body = await req.json();
    const query: string = body.query;
    const maxResults: number = body.maxResults ?? 20;
    const icp: string = body.icp || DEFAULT_ICP;
    const useMaps: boolean = body.useMaps ?? true;
    const useSearch: boolean = body.useSearch ?? true;
    const radiusKm: number = body.radiusKm ?? 20;

    if (!query) {
      return new Response(JSON.stringify({ error: "query requis" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const leads: LeadRow[] = [];

    if (useMaps) {
      for (const place of await googlePlacesSearch(query, maxResults, radiusKm)) {
        leads.push({
          nom: place.nom,
          email: "",
          telephone: place.telephone,
          site_web: place.site_web,
          domaine: normalizeDomain(place.site_web),
          adresse: place.adresse,
          note_google: place.note_google ? Number(place.note_google) : null,
          signaux_detectes: "",
          score_ia: null,
          justification_ia: "",
          point_cle: "",
          service_cible: "",
          secteur: "",
          source_requete: query,
          statut_envoi: "en_attente",
        });
      }
    }

    if (useSearch) {
      for (const item of await googleSearch(query, maxResults)) {
        const nom = item.title.split(" - ")[0].split(" | ")[0];
        if (leads.some((l) => l.nom.toLowerCase() === nom.toLowerCase())) continue;
        leads.push({
          nom,
          email: "",
          telephone: "",
          site_web: item.link,
          domaine: normalizeDomain(item.link),
          adresse: "",
          note_google: null,
          signaux_detectes: "",
          score_ia: null,
          justification_ia: "",
          point_cle: "",
          service_cible: "",
          secteur: "",
          source_requete: query,
          statut_envoi: "en_attente",
        });
      }
    }

    // Scraping (email, téléphone, signaux)
    for (const lead of leads) {
      if (lead.site_web) {
        const info = await scrapeWebsite(lead.site_web);
        lead.email = lead.email || info.email;
        lead.telephone = lead.telephone || info.telephone;
        lead.signaux_detectes = info.signaux_detectes;
      }
    }

    // Qualification IA
    for (const lead of leads) {
      const result = await qualifyLead(lead, icp);
      lead.score_ia = result.score;
      lead.justification_ia = result.justification;
      lead.point_cle = result.point_cle;
      lead.service_cible = result.service_cible;
      lead.secteur = result.secteur;
    }

    leads.sort((a, b) => (b.score_ia ?? 0) - (a.score_ia ?? 0));

    // Déduplication par nom + domaine contre l'existant (l'index unique en base est une
    // contrainte fonctionnelle sur lower(nom), lower(domaine) — pas ciblable par upsert onConflict).
    const { data: existing, error: existingError } = await supabase.from("leads").select("nom, domaine");
    if (existingError) throw existingError;
    const existingKeys = new Set(
      (existing ?? []).map((r) => `${r.nom.toLowerCase()}::${(r.domaine ?? "").toLowerCase()}`),
    );

    const seenInBatch = new Set<string>();
    const toInsert = leads.filter((l) => {
      const key = `${l.nom.toLowerCase()}::${l.domaine.toLowerCase()}`;
      if (existingKeys.has(key) || seenInBatch.has(key)) return false;
      seenInBatch.add(key);
      return true;
    });

    let inserted = 0;
    if (toInsert.length) {
      const { data, error } = await supabase.from("leads").insert(toInsert).select("id");
      if (error) throw error;
      inserted = data?.length ?? 0;
    }
    const skipped = leads.length - inserted;

    return new Response(
      JSON.stringify({ total_trouves: leads.length, inserted, skipped }),
      { headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
