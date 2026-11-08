-- Swipe down in Hitta: "Vet inte" (no opinion yet). Hides the title for 7 days.
alter table public.interactions drop constraint interactions_action_check;
alter table public.interactions add constraint interactions_action_check
  check (action in ('right', 'left', 'seen', 'open_detail', 'undo', 'not_seen', 'unsure'));

-- TMDB collection (for example all Harry Potter films), so a deck shows one
-- film per collection at a time.
alter table public.titles add column collection_id int;

-- Cached films have no collection yet: mark their providers stale so the
-- details, collection included, are fetched again the next time they show up.
update public.titles set providers_updated_at = null where media_type = 'movie';
