import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  RELANCE_DELAI_MS,
  SECTEUR_LABELS,
  STATUT_LABELS,
  isRelanceEligible,
  type Lead,
} from "../lib/types";

type Statut = Lead["statut_envoi"];

const SECTEUR_ORDER = ["batiment", "alimentaire", "personne", "restauration", "generique"];
const STATUT_ORDER: Statut[] = ["en_attente", "envoyé", "relance_envoyee", "répondu", "ignoré"];
const DAY_MS = 24 * 60 * 60 * 1000;
const ROWS_STEP = 50;

const STATUT_STYLES: Record<Statut, { bar: string; pill: string }> = {
  en_attente: { bar: "bg-neutral-300", pill: "bg-neutral-100 text-neutral-600" },
  envoyé: { bar: "bg-fyn", pill: "bg-fyn-light text-fyn-dark" },
  relance_envoyee: { bar: "bg-amber-400", pill: "bg-amber-50 text-amber-700" },
  répondu: { bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700" },
  ignoré: { bar: "bg-neutral-400", pill: "bg-neutral-100 text-neutral-400" },
};

interface Envoi {
  date_envoi: string;
  statut: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function lastActivity(l: Lead): string {
  return l.date_relance || l.date_envoi || l.created_at;
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
      <p className="text-xs font-medium uppercase tracking-wide text-white/60">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${accent ? "text-amber-300" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-white/50">{sub}</p>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {hint && <span className="text-xs text-neutral-400">{hint}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DashboardScreen({ onGoToLeads }: { onGoToLeads: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [envois, setEnvois] = useState<Envoi[]>([]);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState<"tous" | Statut>("tous");
  const [secteurFilter, setSecteurFilter] = useState("tous");
  const [rowsShown, setRowsShown] = useState(ROWS_STEP);
  const [relanceSending, setRelanceSending] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    const [leadsRes, envoisRes] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("envois").select("date_envoi, statut").eq("statut", "succès"),
    ]);
    setLeads((leadsRes.data as Lead[] | null) ?? []);
    setEnvois((envoisRes.data as Envoi[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const prets = leads.filter((l) => l.statut_envoi === "en_attente" && l.email);
    const sansEmail = leads.filter((l) => l.statut_envoi === "en_attente" && !l.email);
    const contactes = leads.filter((l) => l.date_envoi);
    const repondus = leads.filter((l) => l.statut_envoi === "répondu");
    const aRelancer = leads.filter(isRelanceEligible);
    const prochaines = leads
      .filter((l) => l.statut_envoi === "envoyé" && l.date_envoi && !isRelanceEligible(l))
      .map((l) => ({ lead: l, due: new Date(l.date_envoi!).getTime() + RELANCE_DELAI_MS }))
      .sort((a, b) => a.due - b.due);
    const parStatut = Object.fromEntries(STATUT_ORDER.map((s) => [s, 0])) as Record<Statut, number>;
    for (const l of leads) parStatut[l.statut_envoi] += 1;
    return { prets, sansEmail, contactes, repondus, aRelancer, prochaines, parStatut };
  }, [leads]);

  const secteurRows = useMemo(() => {
    const keys = Array.from(new Set([...SECTEUR_ORDER, ...leads.map((l) => l.secteur || "?")]));
    return keys
      .map((k) => {
        const group = leads.filter((l) => (l.secteur || "?") === k);
        const contactes = group.filter((l) => l.date_envoi).length;
        const repondus = group.filter((l) => l.statut_envoi === "répondu").length;
        return {
          key: k,
          label: SECTEUR_LABELS[k] ?? (k === "?" ? "Non classé" : k),
          total: group.length,
          contactes,
          repondus,
          taux: pct(repondus, contactes),
        };
      })
      .filter((r) => r.total > 0);
  }, [leads]);

  // Envois réussis des 14 derniers jours (premiers mails + relances).
  const activity = useMemo(() => {
    const days: { key: string; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push({ key: dayKey(d), label: String(d.getDate()), count: 0 });
    }
    const index = new Map(days.map((d, i) => [d.key, i]));
    for (const e of envois) {
      const i = index.get(dayKey(new Date(e.date_envoi)));
      if (i !== undefined) days[i].count += 1;
    }
    return days;
  }, [envois]);
  const activityMax = Math.max(1, ...activity.map((d) => d.count));
  const activityTotal = activity.reduce((n, d) => n + d.count, 0);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (statutFilter !== "tous" && l.statut_envoi !== statutFilter) return false;
        if (secteurFilter !== "tous" && (l.secteur || "?") !== secteurFilter) return false;
        if (q && !`${l.nom} ${l.email} ${l.domaine}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (lastActivity(a) < lastActivity(b) ? 1 : -1));
  }, [leads, search, statutFilter, secteurFilter]);

  async function changeStatut(id: string, statut: Statut) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, statut_envoi: statut } : l)));
    await supabase.from("leads").update({ statut_envoi: statut }).eq("id", id);
  }

  async function sendRelance(lead: Lead) {
    if (!confirm(`Envoyer la relance à ${lead.nom} ?`)) return;
    setRelanceSending((prev) => new Set(prev).add(lead.id));
    const { data, error } = await supabase.functions.invoke("send-relance", { body: { leadId: lead.id } });
    setRelanceSending((prev) => {
      const next = new Set(prev);
      next.delete(lead.id);
      return next;
    });
    if (error || !data?.success) {
      alert(`Échec de la relance : ${data?.error || error?.message || "erreur inconnue"}`);
      return;
    }
    const now = new Date().toISOString();
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, statut_envoi: "relance_envoyee", date_relance: now } : l)),
    );
    setEnvois((prev) => [...prev, { date_envoi: now, statut: "succès" }]);
  }

  function relanceButton(lead: Lead) {
    return (
      <button
        onClick={() => sendRelance(lead)}
        disabled={relanceSending.has(lead.id)}
        className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
      >
        {relanceSending.has(lead.id) ? "Envoi..." : "Relancer"}
      </button>
    );
  }

  function statutSelect(lead: Lead) {
    return (
      <select
        value={lead.statut_envoi}
        onChange={(e) => changeStatut(lead.id, e.target.value as Statut)}
        className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUT_STYLES[lead.statut_envoi].pill}`}
      >
        {STATUT_ORDER.map((s) => (
          <option key={s} value={s}>{STATUT_LABELS[s]}</option>
        ))}
      </select>
    );
  }

  const total = leads.length;
  const taux = pct(stats.repondus.length, stats.contactes.length);
  const visibleRows = tableRows.slice(0, rowsShown);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">Tableau de bord</h2>
          <p className="text-sm text-neutral-500">Ton pipeline de prospection, de la recherche à la réponse.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setGuideOpen(true)}
            className="rounded-lg border border-fyn px-3 py-1.5 text-sm font-medium text-fyn-dark hover:bg-fyn-light"
          >
            Guide
          </button>
          <button
            onClick={load}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Rafraîchir
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Chargement...</p>
      ) : (
        <>
          {/* Chiffres clés */}
          <div className="rounded-2xl bg-fyn-ink p-4 sm:p-5 dark:ring-1 dark:ring-white/10">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Leads" value={total} sub={`${stats.sansEmail.length} sans email`} />
              <Kpi label="À envoyer" value={stats.prets.length} sub="prêts, avec email" />
              <Kpi label="Contactés" value={stats.contactes.length} sub="premier mail envoyé" />
              <Kpi
                label="À relancer"
                value={stats.aRelancer.length}
                sub="7 jours sans réponse"
                accent={stats.aRelancer.length > 0}
              />
              <Kpi label="Réponses" value={stats.repondus.length} sub="marquées « Répondu »" />
              <Kpi label="Taux de réponse" value={`${taux}%`} sub="sur les contactés" />
            </div>

            {/* Pipeline */}
            <div className="mt-5">
              <div className="flex h-3 overflow-hidden rounded-full bg-white/10">
                {STATUT_ORDER.map((s) =>
                  stats.parStatut[s] > 0 ? (
                    <div
                      key={s}
                      className={STATUT_STYLES[s].bar}
                      style={{ width: `${(stats.parStatut[s] / Math.max(total, 1)) * 100}%` }}
                      title={`${STATUT_LABELS[s]} : ${stats.parStatut[s]}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-white/70">
                {STATUT_ORDER.map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${STATUT_STYLES[s].bar}`} />
                    {STATUT_LABELS[s]}
                    <span className="font-semibold text-white">{stats.parStatut[s]}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* À faire maintenant + prochaines relances */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="À faire maintenant" hint={stats.aRelancer.length ? `${stats.aRelancer.length} relance(s)` : undefined}>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Relances à envoyer</p>
                  {stats.aRelancer.length === 0 ? (
                    <p className="mt-1.5 text-sm text-neutral-500">Aucune relance en attente.</p>
                  ) : (
                    <ul className="mt-1.5 divide-y divide-neutral-100">
                      {stats.aRelancer.slice(0, 6).map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-neutral-900">{l.nom}</p>
                            <p className="text-xs text-neutral-400">
                              {SECTEUR_LABELS[l.secteur] ?? "Non classé"} · envoyé il y a {daysSince(l.date_envoi!)} j
                            </p>
                          </div>
                          {relanceButton(l)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {stats.aRelancer.length > 6 && (
                    <p className="mt-1 text-xs text-neutral-400">
                      + {stats.aRelancer.length - 6} autre(s), visibles dans le suivi ci-dessous.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2.5">
                  <p className="text-sm text-neutral-700">
                    <span className="font-semibold text-neutral-900">{stats.prets.length}</span> lead(s) prêt(s) à envoyer
                  </p>
                  <button
                    onClick={onGoToLeads}
                    className="rounded-lg bg-fyn px-3 py-1 text-xs font-semibold text-fyn-ink hover:bg-fyn-dark hover:text-white"
                  >
                    Choisir les leads
                  </button>
                </div>

                {stats.sansEmail.length > 0 && (
                  <p className="text-sm text-neutral-500">
                    <span className="font-semibold text-neutral-900">{stats.sansEmail.length}</span> lead(s) sans email :
                    ajoute l'adresse dans l'écran Leads pour pouvoir les contacter.
                  </p>
                )}
              </div>
            </Card>

            <Card title="Prochaines relances" hint="7 jours après l'envoi">
              {stats.prochaines.length === 0 ? (
                <p className="text-sm text-neutral-500">Aucune relance planifiée pour l'instant.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {stats.prochaines.slice(0, 7).map(({ lead, due }) => {
                    const left = Math.max(1, Math.ceil((due - Date.now()) / DAY_MS));
                    return (
                      <li key={lead.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900">{lead.nom}</p>
                          <p className="text-xs text-neutral-400">envoyé le {fmtDate(lead.date_envoi)}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-fyn-light px-2.5 py-1 text-xs font-medium text-fyn-dark">
                          dans {left} j · {fmtDate(new Date(due).toISOString())}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {/* Activité + secteurs */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Activité d'envoi" hint={`${activityTotal} mail(s) sur 14 jours`}>
              <div className="flex h-32 items-end gap-1.5">
                {activity.map((d) => (
                  <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.key} : ${d.count}`}>
                    <span className="text-[10px] text-neutral-400">{d.count || ""}</span>
                    <div
                      className={`w-full rounded-t ${d.count ? "bg-fyn" : "bg-neutral-100"}`}
                      style={{ height: `${d.count ? Math.max(6, (d.count / activityMax) * 80) : 3}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5">
                {activity.map((d) => (
                  <span key={d.key} className="flex-1 text-center text-[10px] text-neutral-400">{d.label}</span>
                ))}
              </div>
            </Card>

            <Card title="Résultats par secteur" hint="quel texte marche le mieux">
              {secteurRows.length === 0 ? (
                <p className="text-sm text-neutral-500">Pas encore de leads.</p>
              ) : (
                <ul className="space-y-3">
                  {secteurRows.map((r) => (
                    <li key={r.key}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-neutral-900">{r.label}</span>
                        <span className="text-xs text-neutral-500">
                          {r.total} lead(s) · {r.contactes} contacté(s) · {r.repondus} réponse(s)
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.taux}%` }} />
                        </div>
                        <span className="w-9 text-right text-xs font-semibold text-neutral-700">{r.taux}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Suivi des leads (CRM) */}
          <Card title="Suivi des leads" hint={`${tableRows.length} résultat(s)`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setRowsShown(ROWS_STEP);
                }}
                placeholder="Rechercher une entreprise ou un email"
                className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-fyn sm:max-w-xs"
              />
              <select
                value={secteurFilter}
                onChange={(e) => {
                  setSecteurFilter(e.target.value);
                  setRowsShown(ROWS_STEP);
                }}
                className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="tous">Tous secteurs</option>
                {SECTEUR_ORDER.map((k) => (
                  <option key={k} value={k}>{SECTEUR_LABELS[k]}</option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(["tous", ...STATUT_ORDER] as const).map((s) => {
                const count = s === "tous" ? total : stats.parStatut[s];
                const active = statutFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setStatutFilter(s);
                      setRowsShown(ROWS_STEP);
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      active ? "bg-fyn-ink text-white dark:bg-fyn dark:text-fyn-ink" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                    }`}
                  >
                    {s === "tous" ? "Tous" : STATUT_LABELS[s]} <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Tableau (écran large) */}
            <div className="mt-4 hidden overflow-x-auto sm:block">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs font-medium uppercase text-neutral-400">
                  <tr>
                    <th className="px-2 py-2">Entreprise</th>
                    <th className="px-2 py-2">Secteur</th>
                    <th className="px-2 py-2">Statut</th>
                    <th className="px-2 py-2">Envoyé le</th>
                    <th className="px-2 py-2">Relance</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {visibleRows.map((l) => {
                    const due = l.date_envoi ? new Date(l.date_envoi).getTime() + RELANCE_DELAI_MS : null;
                    return (
                      <tr key={l.id} className="hover:bg-neutral-50">
                        <td className="px-2 py-2">
                          <p className="font-medium text-neutral-900">{l.nom}</p>
                          <p className="text-xs text-neutral-400">{l.email || "pas d'email"}</p>
                        </td>
                        <td className="px-2 py-2 text-neutral-600">{SECTEUR_LABELS[l.secteur] ?? "Non classé"}</td>
                        <td className="px-2 py-2">{statutSelect(l)}</td>
                        <td className="px-2 py-2 text-neutral-600">{fmtDate(l.date_envoi)}</td>
                        <td className="px-2 py-2 text-neutral-600">
                          {l.date_relance
                            ? `faite le ${fmtDate(l.date_relance)}`
                            : l.statut_envoi === "envoyé" && due
                              ? `dès le ${fmtDate(new Date(due).toISOString())}`
                              : "—"}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {isRelanceEligible(l) && relanceButton(l)}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-neutral-400">
                        Aucun lead ne correspond.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Cartes (mobile) */}
            <div className="mt-4 space-y-2 sm:hidden">
              {visibleRows.map((l) => (
                <div key={l.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-900">{l.nom}</p>
                      <p className="truncate text-xs text-neutral-400">{l.email || "pas d'email"}</p>
                    </div>
                    {statutSelect(l)}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    {SECTEUR_LABELS[l.secteur] ?? "Non classé"} ·{" "}
                    {l.date_envoi ? `envoyé le ${fmtDate(l.date_envoi)}` : "pas encore envoyé"}
                    {l.date_relance ? ` · relancé le ${fmtDate(l.date_relance)}` : ""}
                  </p>
                  {isRelanceEligible(l) && (
                    <div className="mt-2">{relanceButton(l)}</div>
                  )}
                </div>
              ))}
              {visibleRows.length === 0 && (
                <p className="py-6 text-center text-sm text-neutral-400">Aucun lead ne correspond.</p>
              )}
            </div>

            {tableRows.length > rowsShown && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => setRowsShown((n) => n + ROWS_STEP)}
                  className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Voir plus ({tableRows.length - rowsShown} restants)
                </button>
              </div>
            )}
          </Card>

          <p className="text-xs text-neutral-400">
            « Répondu » et « Ignoré » se marquent à la main (aucune lecture automatique de ta boîte mail). Les
            relances sont toujours manuelles.
          </p>
        </>
      )}

      {/* Guide */}
      {guideOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={() => setGuideOpen(false)}>
          <aside
            className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-neutral-900">Guide du tableau de bord</h3>
              <button onClick={() => setGuideOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                ✕
              </button>
            </div>
            <ol className="mt-5 space-y-4 text-sm text-neutral-700">
              {[
                ["Recherche", "Tu cherches des entreprises. Elles sont qualifiées automatiquement (score, secteur)."],
                ["Leads", "Tu ouvres l'aperçu du mail (clic sur le nom), tu le corriges si besoin, puis tu coches les leads à contacter."],
                ["Envoi", "Tu lances l'envoi. Les mails partent un par un, avec une pause entre chaque, dans la limite du jour."],
                ["Relance", "7 jours après l'envoi, sans réponse, la relance apparaît dans « À faire maintenant ». Un clic, un seul rappel par lead."],
                ["Réponses", "Quand un prospect répond, passe-le en « Répondu » dans le suivi. Il sort alors des relances et compte dans ton taux de réponse."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fyn text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <p>
                    <strong className="text-fyn-dark">{t}.</strong> {d}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-xs text-neutral-400">
              Les statuts : En attente (pas encore contacté), Envoyé, Relancé, Répondu, Ignoré (à écarter).
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
