import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { eveningStart } from "@/lib/evening";
import { formatCertSE, formatRuntime } from "@/lib/format";
import { DEFAULT_YOUNGEST_AGE, getGroups, type Group } from "@/lib/groups";
import {
  discover,
  getTitles,
  type DiscoverHit,
  type MediaType,
  type Title,
} from "@/lib/tmdb/titles";
import { getGenreIds, getGenreNames } from "@/lib/tmdb/genres";
import { seededRandom, spread } from "@/lib/spread";
import { genresOf } from "@/lib/profile";
import { createAdminClient } from "@/lib/supabase/admin";

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
  providers_link: string | null;
  /** Other groups whose list the title is already on, such as ["Själv"]. */
  savedFor: string[];
  /** Minutes: the film, or one episode. */
  runtime: number | null;
  /** Claude's reason from prompt 2, for the three picks. */
  reason: string | null;
  /** Which slot prompt 2 chose it for; "rewatch" shows the label "Se igen". */
  slot: "safe" | "watchlist" | "wildcard" | "rewatch" | null;
};

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
    tv.with_genres = [G.family, G.kids, G.animation].join("|");
    tv.without_genres = [G.crime, G.mystery].join(",");
    picks.delete("Spännande");
  }

  if (movieGenres.length) movie.with_genres = movieGenres.join("|");
  if (tvGenres.length && group.kind !== "family")
    tv.with_genres = tvGenres.join("|");

  return { mediaTypes: ["movie", "tv"], movie, tv, sortBy, firstPage, maxCert };
}

/** TMDB series genres that cover several film genres. */
const TV_COVERS: Record<number, number[]> = {
  10759: [28, 12], // Action & Adventure
  10765: [878, 14], // Sci-Fi & Fantasy
  10768: [10752], // War & Politics
  10762: [10751], // Kids
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
 * group's own list. "Inte nu" and "Vet inte" are about the moment and hide a
 * title everywhere for 7 days.
 */
/**
 * Titles the user turned down for now: "inte nu" and "vet inte" anywhere in
 * the last 7 days, "inte min grej" in this group, and what was swiped right
 * with this group tonight. Applies to every candidate, se igen titles included.
 */
export async function getDeclined(
  userId: string,
  groupId: string,
): Promise<Set<string>> {
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [notNow, notForUs, savedTonight] = await Promise.all([
    supabase
      .from("interactions")
      .select("tmdb_id, media_type")
      .eq("user_id", userId)
      .in("action", ["left", "unsure"])
      .or("reason.is.null,reason.neq.not_for_me")
      .gte("created_at", weekAgo),
    // The session tells which group "inte min grej" was said in.
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, sessions!inner(group_id)")
      .eq("user_id", userId)
      .eq("action", "left")
      .eq("reason", "not_for_me")
      .eq("sessions.group_id", groupId),
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
  ]);
  if (notNow.error) throw notNow.error;
  if (notForUs.error) throw notForUs.error;
  if (savedTonight.error) throw savedTonight.error;
  return new Set(
    [...notNow.data, ...notForUs.data, ...savedTonight.data].map(key),
  );
}

/**
 * Everything the deck leaves out: disliked, seen, turned down (see
 * getDeclined) and anything already on this group's list.
 */
export async function getExcluded(
  userId: string,
  groupId: string,
): Promise<Set<string>> {
  const supabase = await createClient();
  const [ratings, seen, declined, listed] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type")
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
  ]);
  for (const r of [ratings, seen, listed]) if (r.error) throw r.error;

  const out = new Set<string>(declined);
  for (const r of [...ratings.data!, ...seen.data!, ...listed.data!])
    out.add(key(r));
  return out;
}

export function certNumber(cert: string | null): number | null {
  if (!cert) return null;
  if (cert === "Btl") return 0;
  const n = Number(cert);
  return Number.isFinite(n) ? n : null;
}

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
    services: (t.providers_se?.flatrate ?? [])
      .filter((p) => mine.has(p.id))
      .map((p) => p.name),
    providers_link: t.providers_se?.link ?? null,
    savedFor,
    runtime: t.runtime && t.runtime >= 5 ? t.runtime : null,
    reason: null,
    slot: null,
  };
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
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, sessions!inner(group_id)")
      .eq("user_id", userId)
      .in("action", ["right", "left", "unsure"])
      .neq("sessions.group_id", groupId)
      .gte("created_at", since),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type, group_id")
      .eq("user_id", userId)
      .neq("group_id", groupId),
    getGroups(),
  ]);
  if (interactions.error) throw interactions.error;
  if (listed.error) throw listed.error;

  const names = new Map(groups.map((g) => [g.id, g.name]));
  const savedFor = new Map<string, string[]>();
  for (const w of listed.data) {
    const name = names.get(w.group_id);
    if (!name) continue;
    const k = key(w);
    savedFor.set(k, [...(savedFor.get(k) ?? []), name]);
  }
  const reacted = new Set(interactions.data.map(key));
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
}): Promise<{ cards: Card[]; hasMore: boolean }> {
  const tmdbPage = filters.firstPage + page - 1;
  const results = await Promise.all(
    filters.mediaTypes.map((t) =>
      discover(t, {
        providerIds,
        page: tmdbPage,
        sortBy: filters.sortBy,
        filters: filters[t],
      }),
    ),
  );
  const longest = Math.max(0, ...results.map((r) => r.hits.length));
  const hits: DiscoverHit[] = Array.from({ length: longest }, (_, i) =>
    results.map((r) => r.hits[i]),
  )
    .flat()
    .filter((h) => h !== undefined);

  const [excluded, other, rows, genres] = await Promise.all([
    getExcluded(userId, groupId),
    getOtherGroups(userId, groupId),
    getTitles(hits),
    getGenreNames(),
  ]);
  const skipSet = new Set(skip);
  const mine = new Set(providerIds);

  const kept = hits.flatMap((h) => {
    const k = key(h);
    const row = rows.get(k);
    if (!row || excluded.has(k) || skipSet.has(k)) return [];
    if (!(row.providers_se?.flatrate ?? []).some((p) => mine.has(p.id)))
      return [];
    if (filters.maxCert !== null) {
      const cert = certNumber(row.certification_se);
      if (cert !== null && cert > filters.maxCert) return [];
    }
    return [row];
  });
  // One film per series at a time, genres taking turns. Series already shown
  // earlier in the session stay out of this page.
  // Titles already handled in another group come after the new ones.
  // Sorted by the taste profile, then spread so genres still take turns.
  // Average, not sum: a title with five genres (often a children's film:
  // animation, family, comedy, adventure, fantasy) must not win on count.
  const score = (row: Title) => {
    const gs = genresOf(row.genre_ids);
    if (gs.length === 0) return 0;
    return gs.reduce((sum, g) => sum + (affinity[g] ?? 0), 0) / gs.length;
  };
  const sorted = kept
    .map((row, i) => ({ row, i, s: score(row) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.row);
  const spreadRows = spread(sorted, await collectionsOf(skip));
  const fresh = spreadRows.filter((r) => !other.reacted.has(key(r)));
  const known = spreadRows.filter((r) => other.reacted.has(key(r)));
  const cards = [...jitter(fresh, `${seed}:${page}`), ...known].map((row) =>
    toCard(row, mine, genres, other.savedFor.get(key(row)) ?? []),
  );

  return { cards, hasMore: results.some((r) => tmdbPage < r.totalPages) };
}
