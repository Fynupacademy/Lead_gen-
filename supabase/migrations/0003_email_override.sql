-- Permet d'éditer manuellement l'email généré avant envoi (Écran 2). Si renseigné, ces valeurs
-- priment sur la génération automatique au moment de l'envoi (voir send-emails).
alter table leads add column if not exists email_override_subject text default '';
alter table leads add column if not exists email_override_body text default '';
