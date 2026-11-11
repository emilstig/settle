-- The user chooses which groups they use: in onboarding ("Vem brukar du
-- titta med?") and in Profil. A switched-off group is hidden in the app, but
-- nothing is deleted: its lists, ratings and history come back with it.
-- Själv is always on. Existing groups stay on.
alter table public.groups
  add column hidden boolean not null default false;
