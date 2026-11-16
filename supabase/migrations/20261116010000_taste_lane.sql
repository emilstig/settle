-- The taste lane: Haiku turns the taste profile into discover searches
-- (logged in suggest_runs as "taste"), and swipes on those cards get the
-- source "taste".
alter table public.suggest_runs drop constraint suggest_runs_prompt_check;
alter table public.suggest_runs add constraint suggest_runs_prompt_check
  check (prompt in ('parse', 'pick', 'style', 'taste'));

alter table public.interactions drop constraint interactions_source_check;
alter table public.interactions add constraint interactions_source_check
  check (source in ('popular', 'similar', 'pick', 'mood', 'rated', 'taste'));
