-- FynUp Lead Gen — schéma initial
-- Tables leads + envois, RLS restreinte aux utilisateurs authentifiés (app mono-utilisateur interne).

create extension if not exists "pgcrypto";

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  email text default '',
  telephone text default '',
  site_web text default '',
  domaine text default '',              -- domaine normalisé du site_web, utilisé pour la déduplication
  adresse text default '',
  note_google numeric,
  signaux_detectes text default '',
  score_ia integer,
  justification_ia text default '',
  point_cle text default '',
  service_cible text default '',        -- dashboard / cefco / automatisation / autre
  source_requete text default '',
  statut_envoi text not null default 'en_attente',  -- en_attente / envoyé / répondu / ignoré
  date_envoi timestamptz,
  created_at timestamptz not null default now()
);

-- Dédoublonnage par nom + domaine (voir spec §Module 1)
create unique index if not exists leads_nom_domaine_key
  on leads (lower(nom), lower(domaine));

create index if not exists leads_score_idx on leads (score_ia desc nulls last);
create index if not exists leads_statut_idx on leads (statut_envoi);

create table if not exists envois (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  contenu_email text not null,
  date_envoi timestamptz not null default now(),
  statut text not null   -- 'succès' / 'échec'
);

create index if not exists envois_lead_idx on envois (lead_id);

alter table leads enable row level security;
alter table envois enable row level security;

-- App interne mono-utilisateur : tout utilisateur authentifié (Pierre) a accès complet.
-- Les Edge Functions utilisent la clé service_role et contournent RLS pour l'écriture batch.
create policy "authenticated read leads" on leads
  for select to authenticated using (true);

create policy "authenticated update leads" on leads
  for update to authenticated using (true) with check (true);

create policy "authenticated read envois" on envois
  for select to authenticated using (true);
