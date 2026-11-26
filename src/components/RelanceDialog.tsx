import { useEffect, useState } from "react";
import { readFunctionError } from "../lib/sending";
import { supabase } from "../lib/supabase";
import type { Lead } from "../lib/types";

// Relance d'un lead : on affiche d'abord le texte proposé (objet + corps), modifiable, puis on
// l'envoie seulement au clic. Rien ne part à l'ouverture de la fenêtre.
export default function RelanceDialog({
  lead,
  onClose,
  onSent,
}: {
  lead: Lead;
  onClose: () => void;
  onSent: (lead: Lead) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke("send-relance", { body: { leadId: lead.id, preview: true } })
      .then(async ({ data, error: invokeError }) => {
        if (cancelled) return;
        if (invokeError || !data?.body) {
          setError(await readFunctionError(invokeError, data));
        } else {
          setSubject(data.subject ?? "");
          setBody(data.body ?? "");
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  async function send() {
    if (!subject.trim() || !body.trim()) {
      setError("L'objet et le texte ne peuvent pas être vides.");
      return;
    }
    setSending(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("send-relance", {
      body: { leadId: lead.id, subject, body },
    });
    if (invokeError || !data?.success) {
      setError(await readFunctionError(invokeError, data));
      setSending(false);
      return;
    }
    onSent(lead);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-neutral-900">Relance : {lead.nom}</h3>
            <p className="truncate text-xs text-neutral-500">À : {lead.email || "pas d'email"}</p>
          </div>
          <button onClick={onClose} disabled={sending} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-neutral-500">Chargement du texte...</p>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-neutral-500">
              Relis et modifie si besoin. Le texte part tel quel quand tu cliques sur « Envoyer la relance ».
            </p>
            <div>
              <label className="block text-xs font-medium uppercase text-neutral-500">Objet</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase text-neutral-500">Corps du message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
                rows={14}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={send}
            disabled={loading || sending || !body}
            className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? "Envoi..." : "Envoyer la relance"}
          </button>
          <button
            onClick={onClose}
            disabled={sending}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
