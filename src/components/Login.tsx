import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  // The sign-in e-mail carries a 6-digit code as well as the link: typing the code works on any device.
  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setLoading(false);
    if (error) setError("Code invalide ou expiré. Redemande un lien.");
    // on success the session change is picked up by App.tsx
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">FynUp Lead Gen</h1>
        <p className="mt-1 text-sm text-neutral-500">Connexion par lien magique.</p>

        {sent ? (
          <div className="mt-6 space-y-4">
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              Lien de connexion envoyé à {email}. Vérifie ta boîte mail.
            </p>
            <form onSubmit={handleCode} className="space-y-3">
              <label className="block text-sm text-neutral-600" htmlFor="code">
                Ou saisis le code reçu dans le mail :
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="12345678"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-neutral-500"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? "Vérification..." : "Se connecter avec le code"}
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              placeholder="pierrot@fynup-consulting.ch"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Envoi..." : "Recevoir le lien"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

