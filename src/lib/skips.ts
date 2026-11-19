import "server-only";
import { cache } from "react";
import { genresOf } from "@/lib/profile";
import { fetchAll } from "@/lib/supabase/all";
import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/lib/tmdb/titles";

/**
 * What the user's own swipes in the deck say, beyond the single swipe:
 * a title skipped again and again, and a genre that keeps being skipped.
 */

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365 * DAY_MS;
/**
 * How long "Hoppa över" hides a title, by how many times it has been skipped
 * in the last year: three days, then a week, a month and half a year. The
 * first skip mostly says "not tonight", and another evening is another
 * mood; a card that came back and was skipped again is not one to keep
 * showing.
 */
export const SKIP_HIDE_DAYS = [3, 7, 30, 180] as const;

export const skipHideDays = (times: number) =>
  SKIP_HIDE_DAYS[Math.min(Math.max(times, 1), SKIP_HIDE_DAYS.length) - 1];

type Ref = { tmdb_id: number; media_type: MediaType };
const keyOf = (r: Ref) => `${r.media_type}:${r.tmdb_id}`;

export type Skips = Map<string, { times: number; last: number; ref: Ref }>;

/**
 * Every "Hoppa över" of the last year, per title. Read once per request:
 * the deck's exclusions, the taste fetch and the cards all use it.
 */
export const getSkips = cache(async (userId: string): Promise<Skips> => {
  const supabase = await createClient();
  const since = new Date(Date.now() - YEAR_MS).toISOString();
  const rows = await fetchAll((from, to) =>
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, created_at")
      .eq("user_id", userId)
      .eq("action", "left")
      .eq("reason", "not_now")
      .gte("created_at", since)
      .order("id")
      .range(from, to),
  );
  const out: Skips = new Map();
  for (const r of rows as (Ref & { created_at: string })[]) {
    const k = keyOf(r);
    const at = Date.parse(r.created_at);
    const seen = out.get(k);
    out.set(k, {
      times: (seen?.times ?? 0) + 1,
      last: Math.max(seen?.last ?? 0, at),
      ref: { tmdb_id: r.tmdb_id, media_type: r.media_type },
    });
  }
  return out;
});

/** Titles still hidden by their skips (see SKIP_HIDE_DAYS). */
export function hiddenBySkips(skips: Skips, now = Date.now()): string[] {
  return [...skips.entries()]
    .filter(([, s]) => now - s.last < skipHideDays(s.times) * DAY_MS)
    .map(([k]) => k);
}

/** Swipes in a genre before they say anything, and how far below the user's own average it must fall. */
const GENRE_MIN_SHOWN = 20;
const GENRE_SHARE_OF_AVERAGE = 0.5;

/**
 * Film genre ids the deck has tried and the user keeps skipping: at least 20
 * swipes in the last year, and a right swipe or "Senare" less than half as
 * often as on the user's swipes overall. A rating can make a genre look
 * liked when the evenings say otherwise; such a genre goes on counting in
 * the order of the deck, but no longer chooses what is fetched. Measured
 * against the user's own average, since some say yes to one card in four
 * and others to one in twenty.
 */
export async function genresNotCarrying(userId: string): Promise<Set<number>> {
  const supabase = await createClient();
  const since = new Date(Date.now() - YEAR_MS).toISOString();
  const [skips, yesRows] = await Promise.all([
    getSkips(userId),
    fetchAll((from, to) =>
      supabase
        .from("interactions")
        .select("tmdb_id, media_type")
        .eq("user_id", userId)
        .in("action", ["right", "maybe"])
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    ),
  ]);
  // Per swipe, not per title: a card skipped three times was turned down
  // three times.
  const swipes = new Map<string, { ref: Ref; no: number; yes: number }>();
  for (const [k, s] of skips) swipes.set(k, { ref: s.ref, no: s.times, yes: 0 });
  for (const r of yesRows as Ref[]) {
    const seen = swipes.get(keyOf(r)) ?? { ref: r, no: 0, yes: 0 };
    swipes.set(keyOf(r), { ...seen, yes: seen.yes + 1 });
  }
  let all = 0;
  let allYes = 0;
  for (const s of swipes.values()) {
    all += s.no + s.yes;
    allYes += s.yes;
  }
  if (all < GENRE_MIN_SHOWN || allYes === 0) return new Set();

  const genreIds = new Map<string, number[]>();
  const ids = [...new Set([...swipes.values()].map((s) => s.ref.tmdb_id))];
  const CHUNK = 300;
  const chunks = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
      supabase
        .from("titles")
        .select("tmdb_id, media_type, genre_ids")
        .in("tmdb_id", ids.slice(i * CHUNK, (i + 1) * CHUNK)),
    ),
  );
  for (const { data, error } of chunks) {
    if (error) throw error;
    for (const t of data)
      genreIds.set(keyOf(t as Ref), t.genre_ids as number[]);
  }

  const shown = new Map<number, number>();
  const liked = new Map<number, number>();
  for (const [k, s] of swipes) {
    for (const g of genresOf(genreIds.get(k) ?? [], s.ref.media_type)) {
      shown.set(g, (shown.get(g) ?? 0) + s.no + s.yes);
      liked.set(g, (liked.get(g) ?? 0) + s.yes);
    }
  }
  const floor = (allYes / all) * GENRE_SHARE_OF_AVERAGE;
  return new Set(
    [...shown.entries()]
      .filter(([g, n]) => n >= GENRE_MIN_SHOWN && (liked.get(g) ?? 0) / n < floor)
      .map(([g]) => g),
  );
}
