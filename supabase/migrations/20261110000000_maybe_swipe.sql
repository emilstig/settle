-- Swipe down in Hitta is now "Kanske": saved on the group's list as "maybe"
-- but not for tonight, and hidden in the deck for 7 days. Old "unsure" rows
-- ("Vet inte") stay and still hide their titles for 7 days.
alter table public.interactions drop constraint interactions_action_check;
alter table public.interactions add constraint interactions_action_check
  check (action in ('right', 'left', 'seen', 'open_detail', 'undo', 'not_seen', 'unsure', 'maybe'));

-- "Spara för annan grupp" from the deck's detail view, without the group
-- swiped with: logged as left with this reason. It rests in that group's deck
-- for 7 days and gives no taste signal.
alter table public.interactions drop constraint interactions_reason_check;
alter table public.interactions add constraint interactions_reason_check
  check (reason in ('not_now', 'not_for_me', 'seen', 'other_group'));
