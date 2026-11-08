-- "Inte sett" in calibration is stored as an interaction, so the next
-- calibration can skip titles the user has already said they have not seen.
alter table public.interactions drop constraint interactions_action_check;
alter table public.interactions add constraint interactions_action_check
  check (action in ('right', 'left', 'seen', 'open_detail', 'undo', 'not_seen'));
