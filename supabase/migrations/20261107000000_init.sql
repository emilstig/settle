-- Settle: initial schema. See CLAUDE.md, "Datamodell".
-- Every user table has user_id and RLS so a user only sees their own rows.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- groups
-- Companies the user watches with. Members, invites and custom groups come
-- later as separate tables that reference groups.id, so no existing rows move.
-- ---------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('solo', 'partner', 'family', 'friends', 'custom')),
  youngest_age int check (youngest_age between 0 and 17),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  constraint youngest_age_only_for_family check (youngest_age is null or kind = 'family')
);

create index groups_user_id_idx on public.groups (user_id, sort);

-- True when the group exists and belongs to the current user. Used in RLS
-- checks so a row can never point at someone else's group.
create or replace function public.owns_group(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gid is null
    or exists (select 1 from public.groups g where g.id = gid and g.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- user_providers
-- ---------------------------------------------------------------------------

create table public.user_providers (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id int not null,
  region text not null default 'SE' check (region ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, region, provider_id)
);

-- ---------------------------------------------------------------------------
-- titles (shared TMDB cache, written only by the server with the service role)
-- ---------------------------------------------------------------------------

create table public.titles (
  tmdb_id int not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  title text not null,
  original_title text,
  year int,
  runtime int,
  genre_ids int[] not null default '{}',
  overview text,
  poster_path text,
  vote_average numeric(3, 1),
  certification_se text,
  providers_se jsonb,
  providers_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tmdb_id, media_type)
);

create index titles_updated_at_idx on public.titles (updated_at);
create index titles_providers_updated_at_idx on public.titles (providers_updated_at);

create trigger titles_set_updated_at
  before update on public.titles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ratings: −1 disliked, 1 likes, 2 likes a lot, 3 loves
-- ---------------------------------------------------------------------------

create table public.ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id int not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  rating smallint not null check (rating in (-1, 1, 2, 3)),
  group_id uuid references public.groups (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tmdb_id, media_type)
);

create index ratings_user_updated_idx on public.ratings (user_id, updated_at desc);
create index ratings_group_idx on public.ratings (group_id) where group_id is not null;

create trigger ratings_set_updated_at
  before update on public.ratings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- watch_log
-- ---------------------------------------------------------------------------

create table public.watch_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id int not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  times_seen text check (times_seen in ('once', 'few', 'many')),
  last_seen date,
  last_seen_approx text check (last_seen_approx in ('recent', 'this_year', 'long_ago')),
  status text check (status in ('watching', 'finished', 'dropped')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tmdb_id, media_type),
  constraint status_only_for_tv check (status is null or media_type = 'tv')
);

create trigger watch_log_set_updated_at
  before update on public.watch_log
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- watchlist: one row per group
-- ---------------------------------------------------------------------------

create table public.watchlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id int not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  group_id uuid not null references public.groups (id) on delete cascade,
  interest text not null check (interest in ('maybe', 'want', 'rewatch')),
  added_at timestamptz not null default now(),
  primary key (user_id, tmdb_id, media_type, group_id)
);

create index watchlist_group_idx on public.watchlist (group_id, added_at desc);

-- ---------------------------------------------------------------------------
-- sessions: one "what should we watch" moment
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  mood_text text,
  quick_picks text[] not null default '{}',
  filters jsonb,
  started_at timestamptz not null default now(),
  picked_tmdb_id int,
  picked_media_type text check (picked_media_type in ('movie', 'tv')),
  picked_at timestamptz
);

create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- interactions: every swipe and tap
-- ---------------------------------------------------------------------------

create table public.interactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id int not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  action text not null check (action in ('right', 'left', 'seen', 'open_detail', 'undo')),
  reason text check (reason in ('not_now', 'not_for_me', 'seen')),
  session_id uuid references public.sessions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index interactions_user_created_idx on public.interactions (user_id, created_at desc);
create index interactions_user_title_idx on public.interactions (user_id, tmdb_id, media_type);
create index interactions_session_idx on public.interactions (session_id);

-- ---------------------------------------------------------------------------
-- suggest_runs: log of every Claude call
-- user_id is denormalised from the session so RLS stays a simple equality.
-- ---------------------------------------------------------------------------

create table public.suggest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete cascade,
  prompt text not null check (prompt in ('parse', 'pick')),
  input jsonb,
  output jsonb,
  model text not null,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index suggest_runs_session_idx on public.suggest_runs (session_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.user_providers enable row level security;
alter table public.titles enable row level security;
alter table public.ratings enable row level security;
alter table public.watch_log enable row level security;
alter table public.watchlist enable row level security;
alter table public.sessions enable row level security;
alter table public.interactions enable row level security;
alter table public.suggest_runs enable row level security;

-- groups
create policy "own groups: select" on public.groups
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own groups: insert" on public.groups
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own groups: update" on public.groups
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own groups: delete" on public.groups
  for delete to authenticated using (user_id = (select auth.uid()));

-- user_providers, watch_log, interactions: plain ownership
do $$
declare t text;
begin
  foreach t in array array['user_providers', 'watch_log'] loop
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Tables that point at a group or session must point at the user's own.
create policy "own rows" on public.ratings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_group(group_id));

create policy "own rows" on public.watchlist for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_group(group_id));

create policy "own rows" on public.sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_group(group_id));

create policy "own rows" on public.interactions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (session_id is null or exists (
      select 1 from public.sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  );

create policy "own rows" on public.suggest_runs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (session_id is null or exists (
      select 1 from public.sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  );

-- titles: everyone signed in can read, only the service role writes.
create policy "read titles" on public.titles for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Grants (explicit, so the Data API exposes exactly this)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on
  public.groups, public.user_providers, public.ratings, public.watch_log,
  public.watchlist, public.sessions, public.interactions, public.suggest_runs
  to authenticated;
grant select on public.titles to authenticated;
grant all on public.titles to service_role;
revoke execute on function public.owns_group(uuid) from anon, public;
grant execute on function public.owns_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Default groups for every new user: Själv, Partner, Familj, Vänner
-- ---------------------------------------------------------------------------

create or replace function public.create_default_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.groups (user_id, name, kind, sort) values
    (new.id, 'Själv', 'solo', 0),
    (new.id, 'Partner', 'partner', 1),
    (new.id, 'Familj', 'family', 2),
    (new.id, 'Vänner', 'friends', 3);
  return new;
end;
$$;

revoke execute on function public.create_default_groups() from anon, authenticated, public;

create trigger on_auth_user_created_groups
  after insert on auth.users
  for each row execute function public.create_default_groups();
