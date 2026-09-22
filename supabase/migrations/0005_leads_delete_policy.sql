-- Suppression manuelle de leads (point 7) : le frontend supprime directement via le client
-- authentifié (pas de service_role), donc il faut une policy RLS explicite pour delete.
-- envois a "on delete cascade" sur lead_id (migration 0001) ; la policy delete sur envois
-- couvre le cas où PostgreSQL vérifie les droits RLS de la table enfant pendant la cascade.
create policy "authenticated delete leads" on leads
  for delete to authenticated using (true);

create policy "authenticated delete envois" on envois
  for delete to authenticated using (true);
