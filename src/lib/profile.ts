import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getGroups } from "@/lib/groups";
import { getGenreNames } from "@/lib/tmdb/genres";

/**
 * The taste profile that becomes {{PROFILE}} in prompt 2, per the domain rules:
 * top 10 loved, the 10 latest ratings, disliked and dropped from the last
 * year, and a genre profile. Kept short, around 30 lines.
 */

const YEAR_MS = 365 * 24 * 3600 * 1000;
/** Genre weights from the domain rules. */
const WEIGHT: Record<number, number> = { 3: 3, 2: 2, 1: 1, [-1]: -2 };
const DROPPED_WEIGHT = -1;
const RATING_LABEL: Record<number, string> = { 3: "älskar", 2: "gillar mycket", 1: "gillar", [-1]: "ogillade" };
const TOP_GENRES = 6;
const LOW_GENRES = 3;

type Ref = { tmdb_id: number; media_type: "movie" | "tv" };
type TitleInfo = { title: string; year: number | null; genre_ids: number[] };

export type TasteProfile = {
  text: string;
  ratingCount: number;
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
const decay = (at: string, now: number) => Math.pow(0.5, Math.max(0, now - Date.parse(at)) / YEAR_MS);
const fmt = (n: number) => n.toFixed(1).replace(".", ",").replace("-", "−");

export async function buildProfile(userId: string): Promise<TasteProfile> {
  const supabase = await createClient();
  const [ratingsRes, droppedRes, groups, genreNames] = await Promise.all([
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
    getGroups(),
    getGenreNames(),
  ]);
  if (ratingsRes.error) throw ratingsRes.error;
  if (droppedRes.error) throw droppedRes.error;
  const ratings = ratingsRes.data as (Ref & { rating: number; group_id: string | null; updated_at: string })[];
  const dropped = droppedRes.data as (Ref & { updated_at: string })[];

  if (ratings.length === 0 && dropped.length === 0) {
    return { text: "Inga betyg än.", ratingCount: 0 };
  }

  // Titles are cached in `titles` when they are shown, so every rated title is there.
  const ids = [...new Set([...ratings, ...dropped].map((r) => r.tmdb_id))];
  const { data: rows, error } = await supabase
    .from("titles")
    .select("tmdb_id, media_type, title, year, genre_ids")
    .in("tmdb_id", ids);
  if (error) throw error;
  const titles = new Map<string, TitleInfo>(rows.map((t) => [keyOf(t as Ref), t as TitleInfo]));

  const groupName = new Map(groups.filter((g) => g.kind !== "solo").map((g) => [g.id, g.name]));
  const name = (r: Ref & { group_id?: string | null }) => {
    const t = titles.get(keyOf(r));
    if (!t) return null;
    const kind = r.media_type === "movie" ? "film" : "serie";
    const group = r.group_id ? groupName.get(r.group_id) : undefined;
    return `${t.title} (${[kind, t.year].filter(Boolean).join(", ")})${group ? `, med ${group}` : ""}`;
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
    ratings.filter((r) => r.rating === 3).slice(0, 10).map(name),
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
    ...ratings.filter((r) => r.rating === -1 && recent(r.updated_at)).map((r) => {
      const n = name(r);
      return n && `${n}: ogillade`;
    }),
    ...dropped.filter((d) => recent(d.updated_at)).map((d) => {
      const n = name(d);
      return n && `${n}: avbröt`;
    }),
  ]);

  // Genre profile: weighted ratings and drops, halved every year.
  const score = new Map<number, number>();
  const add = (r: Ref, weight: number, at: string) => {
    for (const g of titles.get(keyOf(r))?.genre_ids ?? []) {
      score.set(g, (score.get(g) ?? 0) + weight * decay(at, now));
    }
  };
  for (const r of ratings) add(r, WEIGHT[r.rating] ?? 0, r.updated_at);
  for (const d of dropped) add(d, DROPPED_WEIGHT, d.updated_at);

  const ranked = [...score.entries()]
    .filter(([g, s]) => genreNames[g] && Math.abs(s) >= 0.5)
    .sort((a, b) => b[1] - a[1]);
  const liked = ranked.filter(([, s]) => s > 0).slice(0, TOP_GENRES);
  const avoided = ranked.filter(([, s]) => s < 0).slice(-LOW_GENRES).reverse();
  const genreLine = (list: [number, number][]) => list.map(([g, s]) => `${genreNames[g]} ${fmt(s)}`).join(", ");
  if (liked.length) lines.push(`Genrer som väger mest: ${genreLine(liked)}`);
  if (avoided.length) lines.push(`Genrer som undviks: ${genreLine(avoided)}`);

  return { text: lines.join("\n"), ratingCount: ratings.length };
}
