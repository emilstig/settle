import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { eveningStart } from "@/lib/evening";
import { formatCertSE, formatRuntime } from "@/lib/format";
import { DEFAULT_YOUNGEST_AGE, getGroups, type Group } from "@/lib/groups";
import {
  discover,
  getTitles,
  streamingProviders,
  type DiscoverHit,
  type MediaType,
  type Title,
} from "@/lib/tmdb/titles";
import { getGenreIds, getGenreNames } from "@/lib/tmdb/genres";
import { seededRandom, shuffle, spread } from "@/lib/spread";
import { genresOf } from "@/lib/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/all";
import { getSkips, hiddenBySkips } from "@/lib/skips";
import { laneFits, matchesFilters, type SimilarHit } from "@/lib/similar";

export const QUICK_PICKS = [
  "Lätt",
  "Spännande",
  "Kort",
  "Något tryggt",
  "Överraska mig",
] as const;
export type QuickPick = (typeof QUICK_PICKS)[number];

/** Stored in sessions.filters. Rule-based until Claude parses the mood (step 5). */
export const deckFiltersSchema = z.object({
  mediaTypes: z.array(z.enum(["movie", "tv"])),
  movie: z.record(z.string(), z.union([z.string(), z.number()])),
  tv: z.record(z.string(), z.union([z.string(), z.number()])),
  sortBy: z.string(),
  firstPage: z.number().int().min(1),
  maxCert: z.number().int().nullable(),
  /** What prompt 1 read from the mood, passed on to prompt 2. */
  parsed: z
    .object({
      comfort: z.boolean(),
      novelty: z.enum(["low", "medium", "high"]),
      vibe: z.string(),
      /** Prompt 1's heading for the deck; older sessions lack it. */
      label: z.string().optional(),
      /**
       * The mood asked for something the group's own limits leave out, such
       * as murder mysteries with Familj: the deck says so.
       */
      unfit: z.boolean().optional(),
    })
    .optional(),
  /**
   * The taste lane's searches for the session, as discover filters (see
   * suggest/taste.ts). Kept so later pages do not ask Claude again.
   */
  lane: z
    .array(
      z.object({
        type: z.enum(["movie", "tv"]),
        label: z.string(),
        filters: z.record(z.string(), z.union([z.string(), z.number()])),
      }),
    )
    .optional(),
  /**
   * The deck is from the taste alone (see no-ai.ts): the popular and rated
   * lists stay out until the user asks for them at the end.
   */
  tasteOnly: z.boolean().optional(),
  /** How far prompt 1's filters were loosened to fill the deck (see relax). */
  relaxed: z.number().int().min(1).max(3).optional(),
  /** The session runs without Claude, for comparison (see no-ai.ts). */
  noAi: z.boolean().optional(),
  /**
   * Genres from the taste profile for the popular list, when there is no
   * mood (see withTaste). Kept apart from movie/tv so the lane and the
   * candidates for Toppval are not narrowed by them.
   */
  taste: z
    .object({
      movie: z.record(z.string(), z.union([z.string(), z.number()])),
      tv: z.record(z.string(), z.union([z.string(), z.number()])),
    })
    .optional(),
});
export type DeckFilters = z.infer<typeof deckFiltersSchema>;

export type Card = {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year: number | null;
  meta: string;
  overview: string | null;
  poster_path: string | null;
  vote_average: number | null;
  certification: string | null;
  services: string[];
  /** TMDB logo paths for `services`, in the same order (missing logos left out). */
  service_logos: string[];
  providers_link: string | null;
  /** Other groups whose list the title is already on, such as ["Själv"]. */
  savedFor: string[];
  /** Minutes: the film, or one episode. */
  runtime: number | null;
  /** Claude's reason from prompt 2, for the three picks. */
  reason: string | null;
  /** Which slot prompt 2 chose it for; "rewatch" shows the label "Se igen". */
  slot: "safe" | "watchlist" | "wildcard" | "rewatch" | null;
  /**
   * Where the card came from in the deck: the popular list, the lane "Liknar
   * det ni gillat", or Claude's top picks. Saved with each swipe, so the
   * right-swipe rate can be compared per source.
   */
  source: CardSource | null;
  /** Seen before and rested (see getRestedSeen): the card says "Se igen". */
  seen?: boolean;
  /** TMDB's genre ids, for rules that weigh a card against the taste. */
  genre_ids?: number[];
  /**
   * Times the title was skipped in the last year, when any: the next skip
   * hides it longer, and the toast says for how long (see skips.ts).
   */
  skipped?: number;
  /**
   * Show the source on the card. Temporary, while the lanes are compared:
   * only for the accounts that may compare (see no-ai.ts).
   */
  showSource?: boolean;
};
/** "mood": named by Claude for the free text (see suggest/style.ts). */
/**
 * "rated": the well-rated lane (see RATED_FLOOR), fetched by rating instead
 * of by popularity.
 */
export type CardSource =
  | "popular"
  | "similar"
  | "pick"
  | "mood"
  | "rated"
  /** The taste lane: searches written from the profile (suggest/taste.ts). */
  | "taste";

const G = {
  comedy: 35,
  thriller: 53,
  crime: 80,
  mystery: 9648,
  horror: 27,
  family: 10751,
  kids: 10762,
  animation: 16,
  actionAdventureTv: 10759,
};

/** Swedish rating ceiling for a child of the given age: Btl (0), 7, 11, 15. */
function maxCertForAge(age: number): number {
  if (age >= 15) return 15;
  if (age >= 11) return 11;
  if (age >= 7) return 7;
  return 0;
}
const CERT_LABEL: Record<number, string> = {
  0: "Btl",
  7: "7",
  11: "11",
  15: "15",
};

export function buildFilters(group: Group, quickPicks: string[]): DeckFilters {
  const picks = new Set(quickPicks);
  const movie: Record<string, string | number> = { "vote_count.gte": 100 };
  const tv: Record<string, string | number> = { "vote_count.gte": 50 };
  let sortBy = "popularity.desc";
  let firstPage = 1;
  let maxCert: number | null = null;

  const movieGenres: number[] = [];
  const tvGenres: number[] = [];
  if (picks.has("Lätt")) {
    movieGenres.push(G.comedy);
    tvGenres.push(G.comedy);
  }
  if (picks.has("Spännande")) {
    movieGenres.push(G.thriller, G.crime, G.mystery);
    tvGenres.push(G.crime, G.mystery, G.actionAdventureTv);
  }
  if (picks.has("Kort")) {
    movie["with_runtime.lte"] = 100;
    tv["with_runtime.lte"] = 35;
  }
  if (picks.has("Något tryggt")) sortBy = "vote_count.desc";
  if (picks.has("Överraska mig")) firstPage = 1 + Math.floor(Math.random() * 5);

  if (group.kind === "family") {
    // Everyone watches together: Swedish age rating and nothing scary.
    maxCert = maxCertForAge(group.youngest_age ?? DEFAULT_YOUNGEST_AGE);
    movie.certification_country = "SE";
    movie["certification.lte"] = CERT_LABEL[maxCert];
    movie.without_genres = [G.horror, G.thriller].join(",");
    // TV has no certification filter in discover, so stick to family genres.
    tv.with_genres = (
      forKids(maxCert) ? KIDS_TV_GENRES : [G.family, G.kids, G.animation]
    ).join("|");
    tv.without_genres = [G.crime, G.mystery].join(",");
    picks.delete("Spännande");
  }

  // With young children films keep to family and animation (see fitsAge).
  if (forKids(maxCert)) movie.with_genres = KIDS_FILM_GENRES.join("|");
  else if (movieGenres.length) movie.with_genres = movieGenres.join("|");
  if (tvGenres.length && group.kind !== "family")
    tv.with_genres = tvGenres.join("|");

  return { mediaTypes: ["movie", "tv"], movie, tv, sortBy, firstPage, maxCert };
}

/** Liked genres to pick from per session, and how many to use at once. */
const TASTE_POOL = 6;
const TASTE_PER_SESSION = 3;
/** Weights that count as liked, and as clearly turned down. */
const TASTE_LIKED = 0.2;
const TASTE_AVOIDED = -0.5;
const DRAMA = 18;
/** Film genres as TMDB's series genres, for discover on /tv. */
const FILM_AS_TV: Record<number, number> = {
  28: 10759, // Action → Action & Adventure
  12: 10759, // Äventyr → Action & Adventure
  878: 10765, // Science Fiction → Sci-Fi & Fantasy
  14: 10765, // Fantasy → Sci-Fi & Fantasy
  10752: 10768, // Krig → War & Politics
};
/**
 * Film genres that do not carry over to series in the taste: Familj on a
 * series is Barn (see genresOf), and animated series are mostly children's
 * shows and anime, a different evening from Pixar or Ghibli. A taste for
 * them asked for Henry Danger, Young Sheldon and Bleach.
 */
const FILM_ONLY = new Set([16, 10751]);
/**
 * Formats rather than genres: Dokumentär, Reality, Nyheter and Talkshow cut
 * across what a title is about. A liking for documentaries is not a wish
 * for a documentary evening, so they never choose the fetch, and they are
 * left out of it so Kriminal does not fill up with true crime. They still
 * come through Toppval, the lane, rested titles and a mood that asks.
 */
const FORMATS = [99, 10764, 10763, 10767];

/**
 * Without a mood the popular list is the same for everyone with the same
 * services, and the taste profile could only reorder it. Here the list is
 * fetched within a few of the user's liked genres instead, a different few
 * each session so the evenings vary, and without the genres they clearly
 * turned down. With too little taste to go on (a new account), nothing
 * changes. Only for a deck without mood and outside Familj, whose filters
 * already narrow the list.
 */
export async function withTaste(
  filters: DeckFilters,
  affinity: Record<number, number>,
  seed: string,
  /** Genres with enough titles to steer the fetch (TasteProfile.established). */
  established: ReadonlySet<number>,
): Promise<DeckFilters> {
  const ranked = Object.entries(affinity)
    .map(([g, w]) => [Number(g), w] as const)
    .filter(([g]) => established.has(g))
    .sort((a, b) => b[1] - a[1]);
  // Drama is on most titles, so on its own it is close to the popular list:
  // it is used only when there is little else to go on.
  const liked = ranked
    .filter(([g, w]) => w >= TASTE_LIKED && !FORMATS.includes(g))
    .map(([g]) => g)
    .sort((a, b) => Number(a === DRAMA) - Number(b === DRAMA))
    .slice(0, TASTE_POOL);
  if (liked.length < 2) return filters;
  const pool = liked.filter((g) => g !== DRAMA).length >= 2
    ? liked.filter((g) => g !== DRAMA)
    : liked;
  const chosen = shuffle(pool, `${seed}:taste`).slice(0, TASTE_PER_SESSION);
  const avoided = ranked.filter(([, w]) => w <= TASTE_AVOIDED).map(([g]) => g);
  const valid = await getGenreIds();
  const asType = (type: MediaType, ids: number[]) => [
    ...new Set(
      ids
        .filter((g) => type === "movie" || !FILM_ONLY.has(g))
        .map((g) => (type === "tv" ? (FILM_AS_TV[g] ?? g) : g))
        .filter((g) => valid[type].includes(g)),
    ),
  ];
  const taste = { movie: {}, tv: {} } as NonNullable<DeckFilters["taste"]>;
  for (const type of filters.mediaTypes) {
    // A genre the mood or the group already set is left as it is.
    if (filters[type].with_genres) continue;
    const want = asType(type, chosen);
    if (want.length === 0) continue;
    // A series genre covering a liked film genre is not left out.
    const without = [
      ...new Set([
        ...asType(type, avoided),
        ...FORMATS.filter((g) => valid[type].includes(g)),
      ]),
    ].filter((g) => !want.includes(g));
    taste[type] = {
      with_genres: want.join("|"),
      ...(without.length ? { without_genres: without.join(",") } : {}),
    };
  }
  return { ...filters, taste };
}

/**
 * The discover queries for a media type: one, or with taste genres one per
 * genre, so each liked genre brings its own popular titles instead of all of
 * them meeting in the same few that are popular everywhere.
 */
function discoverQueries(
  filters: DeckFilters,
  type: MediaType,
): Record<string, string | number>[] {
  const base = filters[type];
  const taste = filters.taste?.[type];
  if (!taste?.with_genres) return [base];
  const without = [
    ...new Set(
      [base.without_genres, taste.without_genres]
        .filter(Boolean)
        .flatMap((v) => String(v).split(",")),
    ),
  ];
  return String(taste.with_genres)
    .split("|")
    .map((g) => ({
      ...base,
      with_genres: g,
      ...(without.length ? { without_genres: without.join(",") } : {}),
    }));
}

/** TMDB series genres that cover several film genres. */
const TV_COVERS: Record<number, number[]> = {
  10759: [28, 12], // Action & Adventure
  10765: [878, 14], // Sci-Fi & Fantasy
  10768: [10752], // War & Politics
  10751: [10762], // Family on a series counts as Barn (see genresOf)
};

/**
 * Leaves out genres the group has clearly turned down (see buildGroupTaste),
 * unless the mood asked for them. A combined series genre is left out only
 * when all the film genres it covers are.
 */
export async function withoutGroupGenres(
  filters: DeckFilters,
  avoid: number[],
): Promise<DeckFilters> {
  if (avoid.length === 0) return filters;
  const valid = await getGenreIds();
  const avoided = new Set(avoid);
  const ids = {
    movie: avoid.filter((g) => valid.movie.includes(g)),
    tv: valid.tv.filter((g) =>
      (TV_COVERS[g] ?? [g]).every((f) => avoided.has(f)),
    ),
  };
  const out: DeckFilters = {
    ...filters,
    movie: { ...filters.movie },
    tv: { ...filters.tv },
  };
  for (const type of ["movie", "tv"] as const) {
    const f = out[type];
    const list = (v: unknown) =>
      String(v ?? "")
        .split(/[,|]/)
        .filter(Boolean)
        .map(Number);
    const asked = new Set(list(f.with_genres));
    const without = [
      ...new Set([
        ...list(f.without_genres),
        ...ids[type].filter((g) => !asked.has(g)),
      ]),
    ];
    if (without.length) f.without_genres = without.join(",");
  }
  return out;
}

export const key = (t: { tmdb_id: number; media_type: string }) =>
  `${t.media_type}:${t.tmdb_id}`;

/**
 * Titles that must not be suggested now, per the domain rules. Facts about the
 * user apply in every group: disliked, dropped or already seen. Decisions about
 * the company apply in the group they were made in: "inte min grej" and the
 * group's own list. "Inte nu" and "Kanske" (earlier "Vet inte") are about the
 * moment and hide a title everywhere for 7 days.
 */
/**
 * Titles the user turned down for now: "inte nu" and "kanske" anywhere in
 * the last 7 days, a title skipped more than once for longer (see skips.ts), "inte vår grej" in this group and "inte min grej" in
 * Själv (which holds in every group), and what was swiped right
 * with this group tonight. Applies to every candidate, se igen titles included.
 */
export async function getDeclined(
  userId: string,
  groupId: string,
): Promise<Set<string>> {
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const speaking = await groupsSpeakingFor(groupId);
  const [skips, notNow, notForUs, savedTonight, otherGroup] = await Promise.all([
    getSkips(userId),
    // A week of swipes can pass 1000 rows, so every page is read.
    fetchAll((from, to) =>
      supabase
        .from("interactions")
        .select("tmdb_id, media_type")
        .eq("user_id", userId)
        .in("action", ["left", "unsure", "maybe"])
        .or("reason.is.null,reason.not.in.(not_for_me,other_group)")
        .gte("created_at", weekAgo)
        .order("id")
        .range(from, to),
    ),
    // The session tells which group "inte min grej" was said in. It never
    // runs out, so it can pass 1000 rows too.
    fetchAll((from, to) =>
      supabase
        .from("interactions")
        .select("tmdb_id, media_type, sessions!inner(group_id)")
        .eq("user_id", userId)
        .eq("action", "left")
        .eq("reason", "not_for_me")
        .in("sessions.group_id", speaking)
        .order("id")
        .range(from, to),
    ),
    // Swiped right tonight with the group: it is in Ikväll already, so it
    // does not come back (not even as a top pick) until the next evening,
    // also if it was moved to another group or taken off Ikväll.
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, sessions!inner(group_id)")
      .eq("user_id", userId)
      .eq("action", "right")
      .eq("sessions.group_id", groupId)
      .gte("created_at", eveningStart()),
    // Saved for other groups from this group's deck: it rests here for 7
    // days, but not in the groups it was saved for.
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, sessions!inner(group_id)")
      .eq("user_id", userId)
      .eq("action", "left")
      .eq("reason", "other_group")
      .eq("sessions.group_id", groupId)
      .gte("created_at", weekAgo),
  ]);
  if (savedTonight.error) throw savedTonight.error;
  if (otherGroup.error) throw otherGroup.error;
  return new Set([
    ...[
      ...notNow,
      ...notForUs,
      ...savedTonight.data,
      ...otherGroup.data,
    ].map(key),
    ...hiddenBySkips(skips),
  ]);
}

/**
 * The groups whose no's apply in this one: what is said in Själv is about the
 * user and applies everywhere; what is said in a group stays in it.
 */
export async function groupsSpeakingFor(groupId: string): Promise<string[]> {
  const solo = (await getGroups()).find((g) => g.kind === "solo")?.id;
  return solo && solo !== groupId ? [groupId, solo] : [groupId];
}

/** Whether a rating made with `ratedWith` holds in `groupId` (see groupsSpeakingFor). */
function holdsIn(ratedWith: string | null, speaking: readonly string[]) {
  return ratedWith === null || speaking.includes(ratedWith);
}

/** How long a seen title rests before the deck shows it again, by rating. */
const REST_DAYS: Record<number, number> = { 3: 30, 2: 61, 1: 122, 0: 122 };
const DAY_MS = 24 * 3600 * 1000;

/**
 * Seen titles whose rest is over, with their rating (0 when unrated): 1
 * month after "älskar", 2 after "gillar mycket", 4 after "gillar" or no
 * rating, counted from the latest stand on the title (the rating, Sett, or a
 * swipe). Disliked and dropped titles never rest their way back.
 */
export async function getRestedSeen(
  userId: string,
  /** The deck's group: a dislike made with another group does not hold here. */
  groupId: string,
  now = Date.now(),
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const since = new Date(now - REST_DAYS[0] * DAY_MS).toISOString();
  const [seen, ratings, stands, speaking] = await Promise.all([
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type, status, updated_at")
      .eq("user_id", userId),
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, rating, updated_at, group_id")
      .eq("user_id", userId),
    fetchAll((from, to) =>
      supabase
        .from("interactions")
        .select("tmdb_id, media_type, created_at")
        .eq("user_id", userId)
        .in("action", ["right", "left", "seen", "maybe", "unsure"])
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    ),
    groupsSpeakingFor(groupId),
  ]);
  for (const r of [seen, ratings]) if (r.error) throw r.error;

  const rating = new Map<string, { rating: number; at: number }>();
  for (const r of ratings.data!)
    rating.set(key(r), {
      // A no from another group is theirs: here the title counts as unrated.
      rating: r.rating < 0 && !holdsIn(r.group_id, speaking) ? 0 : r.rating,
      at: Date.parse(r.updated_at),
    });
  const lastStand = new Map<string, number>();
  for (const i of stands) {
    const at = Date.parse(i.created_at);
    if (at > (lastStand.get(key(i)) ?? 0)) lastStand.set(key(i), at);
  }

  const out = new Map<string, number>();
  for (const w of seen.data!) {
    const k = key(w);
    const r = rating.get(k);
    if (w.status === "dropped" || w.status === "watching" || (r && r.rating < 0))
      continue;
    const score = r?.rating ?? 0;
    const last = Math.max(
      Date.parse(w.updated_at),
      r?.at ?? 0,
      lastStand.get(k) ?? 0,
    );
    if (now - last >= (REST_DAYS[score] ?? REST_DAYS[0]) * DAY_MS)
      out.set(k, score);
  }
  return out;
}

/**
 * Everything the deck leaves out: disliked, seen, turned down (see
 * getDeclined) and anything already on this group's list. Seen titles in
 * `rested` are let through, for the deck to take a few per page.
 */
export async function getExcluded(
  userId: string,
  groupId: string,
  rested: ReadonlySet<string> = new Set(),
): Promise<Set<string>> {
  const supabase = await createClient();
  const [ratings, seen, declined, listed, speaking] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, group_id")
      .eq("user_id", userId)
      .eq("rating", -1),
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type")
      .eq("user_id", userId),
    getDeclined(userId, groupId),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type")
      .eq("user_id", userId)
      .eq("group_id", groupId),
    groupsSpeakingFor(groupId),
  ]);
  for (const r of [ratings, seen, listed]) if (r.error) throw r.error;

  const out = new Set<string>(declined);
  // A dislike holds where it was said: in Själv (or calibration) everywhere,
  // with a group only there.
  for (const r of ratings.data!)
    if (holdsIn(r.group_id, speaking)) out.add(key(r));
  for (const r of listed.data!) out.add(key(r));
  for (const r of seen.data!) if (!rested.has(key(r))) out.add(key(r));
  return out;
}

export function certNumber(cert: string | null): number | null {
  if (!cert) return null;
  if (cert === "Btl") return 0;
  const n = Number(cert);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a title fits a group with an age limit (Familj). The Swedish
 * rating says a film does no harm to a child, not that it is for children:
 * The 40 Year-Old Virgin, Ocean's 8 and Bohemian Rhapsody are all "Btl". So
 * with children under 11 a film must also be a family or animated film,
 * and a series a family or children's series.
 */
export function fitsAge(
  row: Pick<Title, "certification_se" | "media_type" | "genre_ids">,
  maxCert: number | null,
): boolean {
  if (maxCert === null) return true;
  const cert = certNumber(row.certification_se);
  if (cert !== null && cert > maxCert) return false;
  if (!forKids(maxCert)) return true;
  const genres: readonly number[] =
    row.media_type === "movie" ? KIDS_FILM_GENRES : KIDS_TV_GENRES;
  return row.genre_ids.some((g) => genres.includes(g));
}

/** Familj with a child under 11 (age limit Btl or 7). */
export const forKids = (maxCert: number | null) =>
  maxCert !== null && maxCert <= 7;
/** Familj and Animerat: what a film must be when the youngest is under 11. */
export const KIDS_FILM_GENRES = [10751, 16];
/**
 * Series have no age filter in discover and seldom a Swedish rating, and
 * Animerat alone brings Rick and Morty, Big Mouth and Arcane: with young
 * children a series must be tagged Familj or Barn.
 */
export const KIDS_TV_GENRES = [10751, 10762];

export function toCard(
  t: Title,
  mine: Set<number>,
  genres: Record<number, string>,
  savedFor: string[] = [],
): Card {
  const length =
    t.media_type === "movie"
      ? formatRuntime(t.runtime)
      : t.runtime && t.runtime >= 5 // TMDB has some bogus 1-minute episode lengths
        ? `${t.runtime} min/avsnitt`
        : null;
  const genreNames = t.genre_ids
    .slice(0, 2)
    .map((id) => genres[id])
    .filter(Boolean);
  return {
    tmdb_id: t.tmdb_id,
    media_type: t.media_type,
    title: t.title,
    year: t.year,
    meta: [
      t.media_type === "movie" ? "Film" : "Serie",
      length,
      genreNames.join(", "),
    ]
      .filter(Boolean)
      .join(" · "),
    overview: t.overview,
    poster_path: t.poster_path,
    vote_average: t.vote_average,
    certification: formatCertSE(t.certification_se),
    services: streamingProviders(t.providers_se)
      .filter((p) => mine.has(p.id))
      .map((p) => p.name),
    service_logos: streamingProviders(t.providers_se)
      .filter((p) => mine.has(p.id))
      .flatMap((p) => (p.logo_path ? [p.logo_path] : [])),
    providers_link: t.providers_se?.link ?? null,
    savedFor,
    genre_ids: t.genre_ids,
    runtime: t.runtime && t.runtime >= 5 ? t.runtime : null,
    reason: null,
    slot: null,
    source: null,
  };
}

/**
 * Titles from the lane "Liknar det ni gillat" per page, and how many of its
 * best to look up, since some are not on the user's services.
 */
const LANE_PER_PAGE = 15;
const LANE_LOOKUP = 60;

/**
 * The well-rated lane. The popular list is what is popular this week, mostly
 * recent titles, and the taste profile can only reorder it; a favourite
 * from 2005 never reaches the sorting. In the test week what the user loved
 * had the median year 2008, the deck's cards 2018. This lane asks discover
 * for the same genres sorted by rating instead, with a floor of votes so a
 * handful of 9s does not lead. With a mood it asks within the mood's
 * filters, so "spännande" brings the best rated thrillers next to this
 * year's. Not for Familj.
 */
const RATED_PER_PAGE = 15;
const RATED_FLOOR = {
  movie: { "vote_count.gte": 1000, "vote_average.gte": 7 },
  tv: { "vote_count.gte": 300, "vote_average.gte": 7.5 },
} as const;

/**
 * The popular list's share of a page while the lanes have cards of their
 * own: its 20 best by the taste, when the two lanes together bring at least
 * 10. In the first measurement the popular list was 54 % of the cards
 * without a mood and got a yes on 10 %, against 25 % for the taste lane and
 * 17 % for "Liknar det ni gillat". A shorter page also means the next one
 * comes sooner, with the lanes' next cards. Not with a mood, where the
 * list is what was asked for, and not when the lanes have run dry.
 */
const POPULAR_PER_PAGE = 20;
const LANES_CARRY = 10;

/** A query with the lane's floor laid over it; a stricter floor of its own stays. */
function ratedQuery(
  q: Record<string, string | number>,
  type: MediaType,
): Record<string, string | number> {
  const out = { ...q };
  for (const [k, v] of Object.entries(RATED_FLOOR[type]))
    out[k] = Math.max(Number(q[k] ?? 0), v);
  return out;
}

/** Takes turns between the lists, starting with the first: a, b, c, a, b, c … */
function interleave<T>(...lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++)
    for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** How long a reaction in another group pushes a title back in this one. */
const OTHER_GROUP_DAYS = 30;

/**
 * What the user already did with titles in other groups. Those titles are not
 * hidden, since the company is different, but they go after new ones, and the
 * card says which lists they are already on.
 */
async function getOtherGroups(
  userId: string,
  groupId: string,
): Promise<{ reacted: Set<string>; savedFor: Map<string, string[]> }> {
  const supabase = await createClient();
  const since = new Date(
    Date.now() - OTHER_GROUP_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const [interactions, listed, groups] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("interactions")
        .select("tmdb_id, media_type, sessions!inner(group_id)")
        .eq("user_id", userId)
        .in("action", ["right", "left", "unsure", "maybe"])
        .neq("sessions.group_id", groupId)
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type, group_id")
      .eq("user_id", userId)
      .neq("group_id", groupId),
    getGroups(),
  ]);
  if (listed.error) throw listed.error;

  // "Sparad för Partner" only for groups the user uses.
  const names = new Map(
    groups.filter((g) => g.kind === "solo" || !g.hidden).map((g) => [g.id, g.name]),
  );
  const savedFor = new Map<string, string[]>();
  for (const w of listed.data) {
    const name = names.get(w.group_id);
    if (!name) continue;
    const k = key(w);
    savedFor.set(k, [...(savedFor.get(k) ?? []), name]);
  }
  const reacted = new Set(interactions.map(key));
  for (const k of savedFor.keys()) reacted.add(k);
  return { reacted, savedFor };
}

/** Shuffles within short windows: the order varies, popular still comes first. */
function jitter<T>(items: T[], seed: string, window = 5): T[] {
  const rand = seededRandom(seed);
  const out: T[] = [];
  for (let i = 0; i < items.length; i += window) {
    const chunk = items.slice(i, i + window);
    for (let j = chunk.length - 1; j > 0; j--) {
      const r = Math.floor(rand() * (j + 1));
      [chunk[j], chunk[r]] = [chunk[r], chunk[j]];
    }
    out.push(...chunk);
  }
  return out;
}

/** Collections of the films already shown, from their "movie:123" keys. */
async function collectionsOf(keys: string[]): Promise<Set<number>> {
  const ids = keys
    .filter((k) => k.startsWith("movie:"))
    .map((k) => Number(k.slice(6)));
  if (ids.length === 0) return new Set();
  const { data, error } = await createAdminClient()
    .from("titles")
    .select("collection_id")
    .eq("media_type", "movie")
    .in("tmdb_id", ids)
    .not("collection_id", "is", null);
  if (error) throw error;
  return new Set(data.map((r) => r.collection_id as number));
}

/** What the rules need about the user, read once for several pages. */
export type DeckContext = {
  excluded: Set<string>;
  /** Seen titles whose rest is over; not in `excluded`, but capped per page. */
  rested: Set<string>;
  /** The same titles with their rating (0 when unrated), for adding them. */
  restedRatings: Map<string, number>;
  other: Awaited<ReturnType<typeof getOtherGroups>>;
};

export async function getDeckContext(
  userId: string,
  groupId: string,
): Promise<DeckContext> {
  const [restedRatings, other] = await Promise.all([
    getRestedSeen(userId, groupId),
    getOtherGroups(userId, groupId),
  ]);
  const rested = new Set(restedRatings.keys());
  return {
    excluded: await getExcluded(userId, groupId, rested),
    rested,
    restedRatings,
    other,
  };
}

/**
 * Rested seen titles a deck page takes: a few, more when the mood is safe,
 * none when it asks for something new.
 */
export function restedPerPage(filters: DeckFilters): number {
  if (filters.parsed?.novelty === "high") return 0;
  return filters.parsed?.comfort ? 4 : 2;
}

/**
 * Rested titles looked up per page when adding them, since some are not on
 * the user's services, and how many stale ones to fetch again from TMDB.
 */
const RESTED_LOOKUP = 30;
const RESTED_REFRESH = 10;

/**
 * Rested seen titles in the order the deck adds them: loved first, then by
 * rating, shuffled per session within each rating so the same few do not
 * open every evening.
 */
function restedOrder(ratings: Map<string, number>, seed: string): string[] {
  return shuffle([...ratings.keys()], `${seed}:rested`).sort(
    (a, b) => (ratings.get(b) ?? 0) - (ratings.get(a) ?? 0),
  );
}

/** One page of cards for a session: discover, refresh the cache, apply the rules. */
export async function loadDeckPage({
  userId,
  groupId,
  providerIds,
  filters,
  page,
  skip = [],
  seed,
  affinity = {},
  similar = [],
  context,
  addRested = true,
}: {
  userId: string;
  groupId: string;
  providerIds: number[];
  filters: DeckFilters;
  page: number;
  skip?: string[];
  /** The session id, so the order varies between sessions. */
  seed: string;
  /** Genre weights from the taste profile; liked genres come first. */
  affinity?: Record<number, number>;
  /** The lane "Liknar det ni gillat" for the session (see getSimilar). */
  similar?: SimilarHit[];
  /** Read once by the caller when it loads several pages (see getDeckContext). */
  context?: DeckContext;
  /**
   * Whether this page adds rested seen titles that discover did not bring.
   * Off for pages loaded side by side with it, so they do not add the same.
   */
  addRested?: boolean;
}): Promise<{ cards: Card[]; hasMore: boolean }> {
  const tmdbPage = filters.firstPage + page - 1;
  // The well-rated lane asks the same queries sorted by rating. A failure
  // there only costs the lane, not the page.
  // Not for Familj: series have no age filter in discover, and sorted by
  // rating its genres lead with animation for adults (Arcane, Evangelion).
  // With a mood the lane keeps to the mood's filters, and stays out when
  // the mood already chose another order than popularity.
  // From the taste alone: neither list is asked for at all.
  const tasteOnly = filters.tasteOnly === true;
  const withRated =
    !tasteOnly &&
    filters.maxCert === null &&
    (!filters.parsed || filters.sortBy === "popularity.desc");
  const [results, ratedResults] = await Promise.all([
    Promise.all(
      (tasteOnly ? [] : filters.mediaTypes).flatMap((t) =>
        discoverQueries(filters, t).map((q) =>
          discover(t, {
            providerIds,
            page: tmdbPage,
            sortBy: filters.sortBy,
            filters: q,
          }),
        ),
      ),
    ),
    withRated
      ? Promise.all(
          filters.mediaTypes.flatMap((t) =>
            discoverQueries(filters, t).map((q) =>
              discover(t, {
                providerIds,
                page: tmdbPage,
                sortBy: "vote_average.desc",
                filters: ratedQuery(q, t),
              }).catch((e) => {
                console.warn("Rated lane failed", e);
                return { hits: [] as DiscoverHit[], totalPages: 0 };
              }),
            ),
          ),
        )
      : [],
  ]);
  const longest = Math.max(0, ...results.map((r) => r.hits.length));
  // A title can come from more than one taste genre: it is kept once.
  const hits: DiscoverHit[] = [
    ...new Map(
      Array.from({ length: longest }, (_, i) => results.map((r) => r.hits[i]))
        .flat()
        .filter((h) => h !== undefined)
        .map((h) => [key(h), h] as const),
    ).values(),
  ];

  const hitKeys = new Set(hits.map(key));
  // The lane's own titles: the ones the popular list did not bring anyway,
  // the queries taking turns like above.
  const ratedLongest = Math.max(0, ...ratedResults.map((r) => r.hits.length));
  const ratedHits: DiscoverHit[] = [
    ...new Map(
      Array.from({ length: ratedLongest }, (_, i) =>
        ratedResults.map((r) => r.hits[i]),
      )
        .flat()
        .filter((h) => h !== undefined && !hitKeys.has(key(h)))
        .map((h) => [key(h), h] as const),
    ).values(),
  ];

  const [{ excluded, rested, restedRatings, other }, rows, ratedRowsByKey, genres] =
    await Promise.all([
      context ?? getDeckContext(userId, groupId),
      getTitles(hits),
      ratedHits.length ? getTitles(ratedHits) : new Map<string, Title>(),
      getGenreNames(),
    ]);
  const skipSet = new Set(skip);
  const mine = new Set(providerIds);
  const ratedRows = ratedHits
    .flatMap((h) => {
      const k = key(h);
      const row = ratedRowsByKey.get(k);
      if (!row || excluded.has(k) || rested.has(k) || skipSet.has(k)) return [];
      if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
        return [];
      if (!fitsAge(row, filters.maxCert)) return [];
      return [row];
    })
    .slice(0, RATED_PER_PAGE);
  const ratedKeys = new Set(ratedRows.map(key));

  // The lane: the best recommendations not yet shown, checked like discover.
  const laneTypes = new Set(
    filters.mediaTypes.filter((t) => laneFits(filters[t])),
  );
  const laneHits = similar
    .filter(
      (h) =>
        laneTypes.has(h.media_type) &&
        !hitKeys.has(key(h)) &&
        !ratedKeys.has(key(h)) &&
        !excluded.has(key(h)) &&
        !rested.has(key(h)) &&
        !skipSet.has(key(h)),
    )
    .slice(0, LANE_LOOKUP);
  const laneRowsByKey = laneHits.length
    ? await getTitles(laneHits)
    : new Map<string, Title>();
  const laneRows = laneHits
    .map((h) => laneRowsByKey.get(key(h)))
    .filter((row): row is Title => {
      if (!row) return false;
      if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
        return false;
      if (!fitsAge(row, filters.maxCert)) return false;
      return matchesFilters(row, filters[row.media_type]);
    })
    .slice(0, LANE_PER_PAGE);

  // Seen titles whose rest is over: a few per page, so the deck stays
  // mostly about something new.
  let restedLeft = restedPerPage(filters);
  const kept = hits.flatMap((h) => {
    const k = key(h);
    const row = rows.get(k);
    if (!row || excluded.has(k) || skipSet.has(k)) return [];
    if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
      return [];
    if (!fitsAge(row, filters.maxCert)) return [];
    if (rested.has(k)) {
      if (restedLeft === 0) return [];
      restedLeft--;
    }
    return [row];
  });
  // Discover sorts by popularity, so older favourites rarely come up on
  // their own: the rest of the page's share is added explicitly, loved
  // first, with the same rules as the lane.
  const restedHits =
    addRested && restedLeft > 0
      ? restedOrder(restedRatings, seed)
          .filter(
            (k) =>
              !hitKeys.has(k) &&
              !ratedKeys.has(k) &&
              !excluded.has(k) &&
              !skipSet.has(k) &&
              laneTypes.has(k.split(":")[0] as MediaType),
          )
          .slice(0, RESTED_LOOKUP)
          .map((k) => {
            const [media_type, id] = k.split(":");
            return { tmdb_id: Number(id), media_type: media_type as MediaType };
          })
      : [];
  const restedRowsByKey = restedHits.length
    ? await getTitles(restedHits, { maxRefresh: RESTED_REFRESH })
    : new Map<string, Title>();
  const restedRows = restedHits
    .map((h) => restedRowsByKey.get(key(h)))
    .filter((row): row is Title => {
      if (!row) return false;
      if (!streamingProviders(row.providers_se).some((p) => mine.has(p.id)))
        return false;
      if (!fitsAge(row, filters.maxCert)) return false;
      return matchesFilters(row, filters[row.media_type]);
    })
    .slice(0, restedLeft);
  kept.push(...restedRows);
  // One film per series at a time, genres taking turns. Series already shown
  // earlier in the session stay out of this page.
  // Titles already handled in another group come after the new ones.
  // Sorted by the taste profile, then spread so genres still take turns.
  // Average, not sum: a title with five genres (often a children's film:
  // animation, family, comedy, adventure, fantasy) must not win on count.
  const score = (row: Title) => {
    const gs = genresOf(row.genre_ids, row.media_type);
    if (gs.length === 0) return 0;
    return gs.reduce((sum, g) => sum + (affinity[g] ?? 0), 0) / gs.length;
  };
  const sorted = kept
    .map((row, i) => ({ row, i, s: score(row) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.row);
  // The lanes keep their own order (most seeds first, highest rated first)
  // and take turns with the popular titles, so the page is not only what
  // is popular right now. While the lanes carry, the popular list gives
  // only its best by the taste: it was half the deck and its weakest part.
  const popular =
    !filters.parsed && laneRows.length + ratedRows.length >= LANES_CARRY
      ? sorted.slice(0, POPULAR_PER_PAGE)
      : sorted;
  const mixed = interleave(laneRows, ratedRows, popular);
  const spreadRows = spread(mixed, await collectionsOf(skip));
  const fresh = spreadRows.filter((r) => !other.reacted.has(key(r)));
  const known = spreadRows.filter((r) => other.reacted.has(key(r)));
  const fromLane = new Set(laneRows.map(key));
  const cards = [...jitter(fresh, `${seed}:${page}`), ...known].map(
    (row): Card => ({
      ...toCard(row, mine, genres, other.savedFor.get(key(row)) ?? []),
      source: fromLane.has(key(row))
        ? "similar"
        : ratedKeys.has(key(row))
          ? "rated"
          : "popular",
      ...(rested.has(key(row)) ? { seen: true } : {}),
    }),
  );

  return {
    cards,
    // From the taste alone there are no pages to count: the caller goes on
    // for as long as cards come.
    hasMore: tasteOnly
      ? cards.length > 0
      : [...results, ...ratedResults].some((r) => tmdbPage < r.totalPages),
  };
}
