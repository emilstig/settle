-- Where a card in Hitta came from, so the right-swipe rate can be compared
-- per source: the popular list, the lane "Liknar det ni gillat", or a top
-- pick (Toppval). Null for calibration, undo and older rows.
alter table public.interactions
  add column source text check (source in ('popular', 'similar', 'pick'));
