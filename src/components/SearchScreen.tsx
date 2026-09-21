import { useState } from "react";
import { supabase } from "../lib/supabase";

type ServiceFilter = "auto" | "dashboard" | "cefco" | "automatisation";

const DEFAULT_ICP =
  "Petites entreprises et indépendants suisses romands, surchargés, sans outil digital " +
  "structuré (pas de dashboard, pas de CRM, gestion manuelle)";

export default function SearchScreen({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [service, setService] = useState<ServiceFilter>("auto");
  const [maxResults, setMaxResults] = useState(20);
  const [icp, setIcp] = useState(DEFAULT_ICP);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ total_trouves: number; inserted: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    const effectiveIcp =
      service === "auto"
        ? icp
        : `${icp}. Priorise le service "${service}" si le lead s'y prête.`;

    const { data, error } = await supabase.functions.invoke("search-leads", {
      body: { query, maxResults, icp: effectiveIcp },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }
    setResult(data);
  }

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">Recherche de leads</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Google Maps + Google Search → scraping → qualification IA → écriture en base.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Requête</label>
          <input
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ex: boulangeries Saint-Gall"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700">Service à cibler</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value as ServiceFilter)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            >
              <option value="auto">Auto-détection</option>
              <option value="dashboard">Dashboard</option>
              <option value="cefco">CEFCO / Compta</option>
              <option value="automatisation">Automatisation</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Nombre de résultats</label>
            <input
              type="number"
              min={1}
              max={100}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        <details className="rounded-lg border border-neutral-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-700">ICP personnalisé</summary>
          <textarea
            value={icp}
            onChange={(e) => setIcp(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </details>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {result && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
            {result.total_trouves} leads trouvés — {result.inserted} nouveaux ajoutés (
            {result.skipped} doublons ignorés).{" "}
            <button type="button" onClick={onDone} className="font-medium underline">
              Voir la liste
            </button>
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Recherche en cours... (peut prendre plusieurs minutes)" : "Lancer la recherche"}
        </button>
      </form>
    </div>
  );
}
