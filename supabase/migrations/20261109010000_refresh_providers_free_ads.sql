-- providers_se now stores free and ad-funded services next to flatrate
-- (SVT Play is mostly free). Mark every cached title's providers stale so
-- they are fetched again the next time the title shows up.
update public.titles set providers_updated_at = null;
