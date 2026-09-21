-- Secteur d'activité (bâtiment/alimentaire/personne/générique/exclu), déterminé à la
-- qualification (Module 1) et réutilisé pour le choix du template d'email (Module 2) —
-- évite de reclassifier via Claude à chaque envoi, et permet un récapitulatif par secteur.
alter table leads add column if not exists secteur text default '';
create index if not exists leads_secteur_idx on leads (secteur);
