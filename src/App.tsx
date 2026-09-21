import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Login from "./components/Login";
import SearchScreen from "./components/SearchScreen";
import LeadsScreen from "./components/LeadsScreen";
import SendScreen from "./components/SendScreen";

type Screen = "recherche" | "leads" | "envoi";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("recherche");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">Chargement...</div>;
  }

  if (!session) {
    return <Login />;
  }

  const tabs: { id: Screen; label: string }[] = [
    { id: "recherche", label: "1. Recherche" },
    { id: "leads", label: "2. Leads" },
    { id: "envoi", label: "3. Envoi" },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-sm font-semibold text-neutral-900">FynUp Lead Gen</h1>
            <p className="text-xs text-neutral-400">{session.user.email}</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            Déconnexion
          </button>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setScreen(t.id)}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                screen === t.id
                  ? "border-b-2 border-neutral-900 text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {screen === "recherche" && <SearchScreen onDone={() => setScreen("leads")} />}
        {screen === "leads" && <LeadsScreen selected={selected} onSelectedChange={setSelected} />}
        {screen === "envoi" && (
          <SendScreen selected={selected} onClearSelected={() => setSelected(new Set())} />
        )}
      </main>
    </div>
  );
}
