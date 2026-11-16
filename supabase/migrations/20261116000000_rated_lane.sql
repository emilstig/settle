-- The well-rated lane: cards fetched by rating instead of by popularity get
-- the source "rated", so their right-swipe rate can be compared per source.
alter table public.interactions drop constraint interactions_source_check;
alter table public.interactions add constraint interactions_source_check
  check (source in ('popular', 'similar', 'pick', 'mood', 'rated'));
