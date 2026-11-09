import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getGroups } from "@/lib/groups";
import { getGenreNames } from "@/lib/tmdb/genres";

/**
 * The taste profile that becomes {{PROFILE}} in prompt 2, per the domain rules:
 * top 10 loved, the 10 latest ratings, disliked and dropped from the last
 * year, and a genre profile. Kept short, around 30 lines.
 *
 * It is the user's own taste: ratings from calibration and from Själv. Ratings
 * made with another group belong to that group's history ({{GROUP_HISTORY}}).
 */

const YEAR_MS = 365 * 24 * 3600 * 1000;
/** Genre weights from the domain rules. */
const WEIGHT: Record<number, number> = { 3: 3, 2: 2, 1: 1, [-1]: -2 };
const DROPPED_WEIGHT = -1;
/** "Inte min grej" in Själv: a mild dislike, as heavy as a drop. */
const NOT_FOR_ME_WEIGHT = -1;
const RATING_LABEL: Record<number, string> = {
  3: "älskar",
  2: "gillar mycket",
  1: "gillar",
  [-1]: "ogillade",
};
const TOP_GENRES = 6;
const LOW_GENRES = 3;
/**
 * Genres are ranked by average weight, not by sum, so a common genre like
 * Drama does not win just by being on everything. The prior pulls genres with
 * few titles towards zero, so one loved film cannot top the list.
 */
const GENRE_PRIOR = 3;
const MIN_GENRE_TITLES = 4;
/**
 * TMDB has separate genres for series. Each is counted as the film genres it
 * covers, so sci-fi is one genre whether it is a film or a series.
 */
const TV_GENRE_AS: Record<number, number[]> = {
  10765: [878, 14], // Sci-Fi & Fantasy → Science Fiction, Fantasy
  10759: [28, 12], // Action & Adventure → Action, Äventyr
  10768: [10752], // War & Politics → Krig
  10762: [10751], // Kids → Familj
};
export const genresOf = (ids: number[]) => [
  ...new Set(ids.flatMap((g) => TV_GENRE_AS[g] ?? [g])),
];

type Ref = { tmdb_id: number; media_type: "movie" | "tv" };
type TitleInfo = { title: string; year: number | null; genre_ids: number[] };

export type TasteProfile = {
  text: string;
  /** Ratings the profile is built from. */
  ratingCount: number;
  /** Ratings made with other groups, left out of the profile. */
  groupRatingCount: number;
  /** Average weight per genre (film genre ids), for sorting the deck. */
  affinity: Record<number, number>;
};

export async function countRatings(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ratings")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

const keyOf = (r: Ref) => `${r.media_type}:${r.tmdb_id}`;
/** Halves every year. */
const decay = (at: string, now: number) =>
  Math.pow(0.5, Math.max(0, now - Date.parse(at)) / YEAR_MS);
const fmt = (n: number) => n.toFixed(1).replace(".", ",").replace("-", "−");

export async function buildProfile(userId: string): Promise<TasteProfile> {
  const supabase = await createClient();
  const [ratingsRes, droppedRes, notForMeRes, groups, genreNames] =
    await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, rating, group_id, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type, updated_at")
      .eq("user_id", userId)
      .eq("status", "dropped"),
    // "Inte min grej" with Själv. Said with other groups it is "inte vår
    // grej" and belongs to that group's history.
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, created_at, sessions!inner(groups!inner(kind))")
      .eq("user_id", userId)
      .eq("action", "left")
      .eq("reason", "not_for_me")
      .eq("sessions.groups.kind", "solo"),
    getGroups(),
    getGenreNames(),
  ]);
  if (ratingsRes.error) throw ratingsRes.error;
  if (droppedRes.error) throw droppedRes.error;
  if (notForMeRes.error) throw notForMeRes.error;
  const allRatings = ratingsRes.data as (Ref & {
    rating: number;
    group_id: string | null;
    updated_at: string;
  })[];
  const dropped = droppedRes.data as (Ref & { updated_at: string })[];
  // Personal: calibration (no group) and Själv.
  const solo = new Set(
    groups.filter((g) => g.kind === "solo").map((g) => g.id),
  );
  const ratings = allRatings.filter(
    (r) => r.group_id === null || solo.has(r.group_id),
  );
  const groupRatingCount = allRatings.length - ratings.length;
  // A later rating of the same title says more than the swipe.
  const rated = new Set(ratings.map(keyOf));
  const notForMe = (
    notForMeRes.data as unknown as (Ref & { created_at: string })[]
  ).filter((r) => !rated.has(keyOf(r)));

  if (ratings.length === 0 && dropped.length === 0 && notForMe.length === 0) {
    return {
      text: "Inga egna betyg än.",
      ratingCount: 0,
      groupRatingCount,
      affinity: {},
    };
  }

  // Titles are cached in `titles` when they are shown, so every rated title is there.
  const ids = [
    ...new Set([...ratings, ...dropped, ...notForMe].map((r) => r.tmdb_id)),
  ];
  const { data: rows, error } = await supabase
    .from("titles")
    .select("tmdb_id, media_type, title, year, genre_ids")
    .in("tmdb_id", ids);
  if (error) throw error;
  const titles = new Map<string, TitleInfo>(
    rows.map((t) => [keyOf(t as Ref), t as TitleInfo]),
  );

  const name = (r: Ref) => {
    const t = titles.get(keyOf(r));
    if (!t) return null;
    const kind = r.media_type === "movie" ? "film" : "serie";
    return `${t.title} (${[kind, t.year].filter(Boolean).join(", ")})`;
  };

  const now = Date.now();
  const lines: string[] = [];
  const section = (heading: string, items: (string | null)[]) => {
    const kept = items.filter((s): s is string => s !== null);
    if (kept.length === 0) return;
    lines.push(heading, ...kept.map((s) => `- ${s}`));
  };

  section(
    "Älskar:",
    ratings
      .filter((r) => r.rating === 3)
      .slice(0, 10)
      .map(name),
  );
  section(
    "Senaste betyg:",
    ratings.slice(0, 10).map((r) => {
      const n = name(r);
      return n && `${n}: ${RATING_LABEL[r.rating]}`;
    }),
  );
  const recent = (at: string) => now - Date.parse(at) < YEAR_MS;
  section("Ogillade eller avbrutna senaste året:", [
    ...ratings
      .filter((r) => r.rating === -1 && recent(r.updated_at))
      .map((r) => {
        const n = name(r);
        return n && `${n}: ogillade`;
      }),
    ...dropped
      .filter((d) => recent(d.updated_at))
      .map((d) => {
        const n = name(d);
        return n && `${n}: avbröt`;
      }),
  ]);

  // Genre profile: weighted ratings, drops and "inte min grej", halved every year, averaged
  // per genre with a prior so a few titles cannot dominate.
  const sum = new Map<number, number>();
  const count = new Map<number, number>();
  const add = (r: Ref, weight: number, at: string) => {
    for (const g of genresOf(titles.get(keyOf(r))?.genre_ids ?? [])) {
      sum.set(g, (sum.get(g) ?? 0) + weight * decay(at, now));
      count.set(g, (count.get(g) ?? 0) + 1);
    }
  };
  for (const r of ratings) add(r, WEIGHT[r.rating] ?? 0, r.updated_at);
  for (const d of dropped) add(d, DROPPED_WEIGHT, d.updated_at);
  for (const n of notForMe) add(n, NOT_FOR_ME_WEIGHT, n.created_at);

  const ranked: [number, number][] = [...sum.entries()]
    .filter(([g]) => genreNames[g] && (count.get(g) ?? 0) >= MIN_GENRE_TITLES)
    .map(([g, total]): [number, number] => [
      g,
      total / ((count.get(g) ?? 0) + GENRE_PRIOR),
    ])
    .filter(([, avg]) => Math.abs(avg) >= 0.1)
    .sort((a, b) => b[1] - a[1]);
  const liked = ranked.filter(([, s]) => s > 0).slice(0, TOP_GENRES);
  const avoided = ranked
    .filter(([, s]) => s < 0)
    .slice(-LOW_GENRES)
    .reverse();
  const genreLine = (list: [number, number][]) =>
    list.map(([g, s]) => `${genreNames[g]} ${fmt(s)}`).join(", ");
  if (liked.length) lines.push(`Genrer som väger mest: ${genreLine(liked)}`);
  if (avoided.length) lines.push(`Genrer som undviks: ${genreLine(avoided)}`);

  return {
    text: lines.join("\n"),
    ratingCount: ratings.length,
    groupRatingCount,
    affinity: Object.fromEntries(ranked),
  };
}

const INTEREST_LABEL: Record<string, string> = {
  maybe: "vill se",
  want: "vill gärna se",
  rewatch: "vill se igen",
};

/**
 * {{GROUP_HISTORY}} in prompt 2: what has been rated, saved and turned down
 * with this group. Short, like the profile. Själv has no separate history.
 */
export async function buildGroupHistory(
  userId: string,
  group: { id: string; kind: string; name: string },
): Promise<string> {
  if (group.kind === "solo")
    return "Ingen, gruppen är Själv (se smakprofilen).";
  const supabase = await createClient();
  const yearAgo = new Date(Date.now() - YEAR_MS).toISOString();
  const [ratingsRes, listRes, notForUsRes] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, rating")
      .eq("user_id", userId)
      .eq("group_id", group.id)
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type, interest")
      .eq("user_id", userId)
      .eq("group_id", group.id)
      .order("added_at", { ascending: false })
      .limit(10),
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, sessions!inner(group_id)")
      .eq("user_id", userId)
      .eq("action", "left")
      .eq("reason", "not_for_me")
      .eq("sessions.group_id", group.id)
      .gte("created_at", yearAgo)
      .limit(10),
  ]);
  for (const r of [ratingsRes, listRes, notForUsRes])
    if (r.error) throw r.error;

  const refs = [
    ...ratingsRes.data!,
    ...listRes.data!,
    ...notForUsRes.data!,
  ] as Ref[];
  if (refs.length === 0)
    return `Inget sparat eller betygsatt med ${group.name} än.`;
  const { data: rows, error } = await supabase
    .from("titles")
    .select("tmdb_id, media_type, title, year")
    .in("tmdb_id", [...new Set(refs.map((r) => r.tmdb_id))]);
  if (error) throw error;
  const titles = new Map(
    rows.map((t) => [
      keyOf(t as Ref),
      t as { title: string; year: number | null },
    ]),
  );
  const name = (r: Ref) => {
    const t = titles.get(keyOf(r));
    return t ? `${t.title}${t.year ? ` (${t.year})` : ""}` : null;
  };

  const lines: string[] = [];
  const add = (heading: string, items: (string | null)[]) => {
    const kept = items.filter((x): x is string => x !== null);
    if (kept.length) lines.push(heading, ...kept.map((x) => `- ${x}`));
  };
  add(
    `Betyg med ${group.name}:`,
    (ratingsRes.data as (Ref & { rating: number })[]).map((r) => {
      const n = name(r);
      return n && `${n}: ${RATING_LABEL[r.rating]}`;
    }),
  );
  add(
    `Sparat för ${group.name}:`,
    (listRes.data as (Ref & { interest: string })[]).map((r) => {
      const n = name(r);
      return n && `${n}: ${INTEREST_LABEL[r.interest] ?? r.interest}`;
    }),
  );
  add(
    `Inte vår grej med ${group.name}:`,
    (notForUsRes.data as Ref[]).map(name),
  );
  return lines.join("\n");
}
