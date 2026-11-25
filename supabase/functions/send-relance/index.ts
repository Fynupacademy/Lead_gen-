// Module 2b — relance manuelle après 7 jours sans réponse (point 6 du brief).
// Toujours déclenché à la main par Pierre-Olivier depuis l'écran Leads, jamais automatique.
// Un lead ne peut recevoir qu'une seule relance : une fois statut_envoi = "relance_envoyee",
// il ne repasse plus par "envoyé" et n'est donc plus jamais éligible.
//
// POST { leadId: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { generateRelance, relanceSubjectFor } from "../_shared/email_template.ts";
import { sendEmail } from "../_shared/smtp.ts";

const SEPT_JOURS_MS = 7 * 24 * 60 * 60 * 1000;

// Rôle du jeton (« authenticated » pour l'app connectée, « anon » pour la clé publique). La
// signature est déjà vérifiée par verify_jwt ; on lit seulement le contenu.
function callerRole(req: Request): string {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role ?? "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { leadId, preview, subject: customSubject, body: customBody } = await req.json();
    if (!leadId) {
      return new Response(JSON.stringify({ error: "leadId requis" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: lead, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (fetchError || !lead) {
      return new Response(JSON.stringify({ error: "Lead introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (lead.statut_envoi !== "envoyé") {
      return new Response(
        JSON.stringify({ error: "Ce lead n'est pas éligible à une relance (déjà relancé, en attente, répondu ou ignoré)." }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    if (!lead.date_envoi || Date.now() - new Date(lead.date_envoi).getTime() < SEPT_JOURS_MS) {
      return new Response(JSON.stringify({ error: "Moins de 7 jours depuis l'envoi initial." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (!lead.email) {
      return new Response(JSON.stringify({ error: "Ce lead n'a pas d'email." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const defaultSubject = relanceSubjectFor(lead.secteur || "");
    const defaultBody = generateRelance(lead.nom, lead.secteur || "");

    // Aperçu : on renvoie le texte proposé sans rien envoyer ni modifier.
    if (preview) {
      return new Response(JSON.stringify({ subject: defaultSubject, body: defaultBody }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Texte modifié à la main dans l'app : accepté seulement d'un utilisateur connecté (pas de la
    // clé publique « anon »), avec des limites de taille.
    const hasCustom = typeof customSubject === "string" || typeof customBody === "string";
    if (hasCustom && callerRole(req) !== "authenticated") {
      return new Response(JSON.stringify({ error: "Texte personnalisé réservé à un utilisateur connecté." }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const subject = (typeof customSubject === "string" && customSubject.trim().slice(0, 200)) || defaultSubject;
    const body = (typeof customBody === "string" && customBody.trim().slice(0, 10000)) || defaultBody;

    const result = await sendEmail(lead.email, subject, body);

    await supabase.from("envois").insert({
      lead_id: lead.id,
      contenu_email: body,
      statut: result.success ? "succès" : "échec",
    });

    if (result.success) {
      await supabase
        .from("leads")
        .update({ statut_envoi: "relance_envoyee", date_relance: new Date().toISOString() })
        .eq("id", lead.id);
    }

    return new Response(
      JSON.stringify({ success: result.success, error: result.error }),
      {
        status: result.success ? 200 : 502,
        headers: { ...corsHeaders, "content-type": "application/json" },
      },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
