-- Suivi des retours prospects : type de réponse, note libre, date de rendez-vous ou de démonstration.
-- Colonnes facultatives, aucune donnée existante n'est modifiée.
alter table public.leads
  add column if not exists type_retour text,
  add column if not exists note_retour text,
  add column if not exists date_rdv timestamptz;

alter table public.leads
  drop constraint if exists leads_type_retour_check;

alter table public.leads
  add constraint leads_type_retour_check check (
    type_retour is null
    or type_retour in ('renseignement', 'rdv', 'demo', 'pas_interesse', 'ne_plus_contacter')
  );
