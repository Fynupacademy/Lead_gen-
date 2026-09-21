// Aperçu de l'email généré pour un lead, sans l'envoyer ni toucher la base (Écran 2, spec).
// POST { leadId: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { EMAIL_SUBJECT, generateEmail } from "../_shared/email_template.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { leadId } = await req.json();
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

    const { data: lead, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (error || !lead) {
      return new Response(JSON.stringify({ error: "Lead introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const generated = await generateEmail(lead.nom, lead.secteur, lead.source_requete, lead.service_cible);

    if (!lead.secteur) {
      await supabase.from("leads").update({ secteur: generated.secteur }).eq("id", lead.id);
    }

    const body = generated.excluded
      ? "Ce lead est exclu du ciblage (secteur restauration/café/traiteur/bar) — aucun email ne sera généré ni envoyé."
      : generated.body;

    return new Response(
      JSON.stringify({ subject: EMAIL_SUBJECT, body, excluded: generated.excluded, secteur: generated.secteur }),
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
