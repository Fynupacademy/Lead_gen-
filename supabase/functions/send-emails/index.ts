// Module 2 — génération + envoi d'un email pour UN lead. Port de send_agent.py.
//
// Le rythme d'envoi (limite quotidienne, délai aléatoire 60-180s anti-spam) est piloté par le
// frontend, qui appelle cette fonction une fois par lead avec une pause entre chaque appel —
// une Edge Function ne peut pas dormir des dizaines de minutes dans une seule requête.
//
// POST { leadId: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { EMAIL_SUBJECT, generateEmail } from "../_shared/email_template.ts";
import { sendEmail } from "../_shared/smtp.ts";

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

    if (lead.statut_envoi === "envoyé") {
      return new Response(JSON.stringify({ success: true, already_sent: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (!lead.email) {
      return new Response(JSON.stringify({ error: "Ce lead n'a pas d'email." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const generated = await generateEmail(lead.nom, lead.source_requete, lead.service_cible);

    if (generated.excluded) {
      await supabase.from("leads").update({ statut_envoi: "ignoré" }).eq("id", lead.id);
      return new Response(
        JSON.stringify({
          success: false,
          excluded: true,
          error: "Secteur exclu du ciblage (restauration/café/bar) — email non envoyé.",
        }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const body = generated.body;
    const subject = EMAIL_SUBJECT;

    const result = await sendEmail(lead.email, subject, body);

    await supabase.from("envois").insert({
      lead_id: lead.id,
      contenu_email: body,
      statut: result.success ? "succès" : "échec",
    });

    if (result.success) {
      await supabase
        .from("leads")
        .update({ statut_envoi: "envoyé", date_envoi: new Date().toISOString() })
        .eq("id", lead.id);
    }

    return new Response(
      JSON.stringify({ success: result.success, error: result.error, subject }),
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
