-- Efter tittning: the clock asks about an earlier evening's choice (a rating,
-- or the status for a series). The answer, or "Såg den inte", is noted on the
-- session that held the choice, so the question is asked once.
alter table public.sessions
  add column checked_in_at timestamptz;
