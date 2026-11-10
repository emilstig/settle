import "server-only";
import { key, toCard, type Card } from "@/lib/deck";
import { createClient } from "@/lib/supabase/server";
import { getGenreNames } from "@/lib/tmdb/genres";
import { getTitles } from "@/lib/tmdb/titles";

/** Titles whose services are fetched again per page load (see getTitles). */
const MAX_REFRESH = 20;

/**
 * The shelves of Historik, the evidence behind Din smak: what the user has
 * seen and how it was, and what was "inte min grej". Anything on a list is
 * in Att se instead, and "Inte nu" and "Kanske" are about the moment.
 */
export type HistoryShelf = "love" | "like" | "seen" | "disliked" | "notForMe";

export type HistoryRef = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  shelf: HistoryShelf;
  rating: -1 | 1 | 2 | 3 | null;
  /** A series the user stopped watching. */
  dropped: boolean;
  /** The latest stand on the title, for newest first. */
  at: string;
  /** For "Inte min grej": the group it was said with. */
  groupId: string | null;
};

export type HistoryItem = Card & Omit<HistoryRef, "tmdb_id" | "media_type">;

type Ref = { tmdb_id: number; media_type: "movie" | "tv" };

/** Where a rating puts a seen title. Dropped series are always Ogillade. */
export function shelfOf(rating: number | null, dropped: boolean): HistoryShelf {
  if (dropped || rating === -1) return "disliked";
  if (rating === 3) return "love";
  if (rating === 1 || rating === 2) return "like";
  return "seen";
}

export async function getHistoryRefs(userId: string): Promise<HistoryRef[]> {
  const supabase = await createClient();
  const [ratingsRes, logRes, notForMeRes, listRes] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, rating, updated_at")
      .eq("user_id", userId),
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type, status, updated_at")
      .eq("user_id", userId),
    // The session tells which group it was said with.
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, created_at, sessions!inner(group_id)")
      .eq("user_id", userId)
      .eq("action", "left")
      .eq("reason", "not_for_me"),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type")
      .eq("user_id", userId),
  ]);
  for (const r of [ratingsRes, logRes, notForMeRes, listRes])
    if (r.error) throw r.error;

  const listed = new Set((listRes.data as Ref[]).map(key));
  const seen = new Map<
    string,
    { ref: Ref; rating: HistoryRef["rating"]; dropped: boolean; at: string }
  >();
  const later = (a: string, b: string) =>
    Date.parse(a) > Date.parse(b) ? a : b;
  for (const r of ratingsRes.data as (Ref & {
    rating: number;
    updated_at: string;
  })[]) {
    seen.set(key(r), {
      ref: { tmdb_id: r.tmdb_id, media_type: r.media_type },
      rating: r.rating as HistoryRef["rating"],
      dropped: false,
      at: r.updated_at,
    });
  }
  for (const w of logRes.data as (Ref & {
    status: string | null;
    updated_at: string;
  })[]) {
    const s = seen.get(key(w));
    seen.set(key(w), {
      ref: { tmdb_id: w.tmdb_id, media_type: w.media_type },
      rating: s?.rating ?? null,
      dropped: w.status === "dropped",
      at: s ? later(s.at, w.updated_at) : w.updated_at,
    });
  }

  const out: HistoryRef[] = [];
  for (const [k, s] of seen) {
    if (listed.has(k)) continue;
    out.push({
      ...s.ref,
      shelf: shelfOf(s.rating, s.dropped),
      rating: s.rating,
      dropped: s.dropped,
      at: s.at,
      groupId: null,
    });
  }

  // "Inte min grej" per title and group, the latest time it was said. A
  // title seen since or put on a list is told by that instead.
  const notForMe = new Map<string, HistoryRef>();
  for (const n of notForMeRes.data as unknown as (Ref & {
    created_at: string;
    sessions: { group_id: string };
  })[]) {
    const k = key(n);
    if (seen.has(k) || listed.has(k)) continue;
    const groupId = n.sessions.group_id;
    const prev = notForMe.get(`${k}:${groupId}`);
    if (prev && Date.parse(prev.at) >= Date.parse(n.created_at)) continue;
    notForMe.set(`${k}:${groupId}`, {
      tmdb_id: n.tmdb_id,
      media_type: n.media_type,
      shelf: "notForMe",
      rating: null,
      dropped: false,
      at: n.created_at,
      groupId,
    });
  }
  out.push(...notForMe.values());
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Historik as cards, newest first. */
export async function getHistory(
  userId: string,
  providerIds: number[],
): Promise<HistoryItem[]> {
  const refs = await getHistoryRefs(userId);
  if (refs.length === 0) return [];
  const [rows, genres] = await Promise.all([
    getTitles(refs, { maxRefresh: MAX_REFRESH }),
    getGenreNames(),
  ]);
  const mine = new Set(providerIds);
  return refs.flatMap((r) => {
    const row = rows.get(key(r));
    if (!row) return [];
    const { shelf, rating, dropped, at, groupId } = r;
    return [
      { ...toCard(row, mine, genres), shelf, rating, dropped, at, groupId },
    ];
  });
}

/** The counts on the Historik row in Profil. */
export function countHistory(refs: HistoryRef[]) {
  let seen = 0;
  let disliked = 0;
  for (const r of refs) {
    if (r.shelf === "disliked") disliked++;
    else if (r.shelf !== "notForMe") seen++;
  }
  return { seen, disliked };
}
