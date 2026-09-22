-- Relance manuelle après 7 jours sans réponse (point 6). Pas de contrainte CHECK sur
-- statut_envoi (colonne texte libre) : "relance_envoyee" s'ajoute simplement aux valeurs
-- utilisées en frontend. date_relance est distincte de date_envoi pour garder la trace de
-- l'envoi initial même après la relance.
alter table leads add column if not exists date_relance timestamptz;
