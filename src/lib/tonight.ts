import "server-only";
import { createClient } from "@/lib/supabase/server";
import { key, toCard, type Card } from "@/lib/deck";
import { getGenreNames } from "@/lib/tmdb/genres";
import { getTitles, type MediaType } from "@/lib/tmdb/titles";

const TIME_ZONE = "Europe/Stockholm";
/** An evening runs from 05:00 to 05:00, so after midnight is still tonight. */
const EVENING_STARTS_AT = 5;

/** Wall-clock time in Stockholm, as a UTC timestamp with the same fields. */
function stockholmWall(d: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
}

/** When tonight started, as an ISO timestamp. */
export function eveningStart(now = new Date()): string {
  const wall = stockholmWall(now);
  const offset = wall - now.getTime();
  const w = new Date(wall);
  let start = Date.UTC(
    w.getUTCFullYear(),
    w.getUTCMonth(),
    w.getUTCDate(),
    EVENING_STARTS_AT,
  );
  if (w.getUTCHours() < EVENING_STARTS_AT) start -= 24 * 3600 * 1000;
  return new Date(start - offset).toISOString();
}

export type Tonight = {
  /** Tonight's choice for the group, if one is made. */
  choice: Card | null;
  /** What was swiped right tonight with the group and is still saved. */
  saved: Card[];
};

type Ref = { tmdb_id: number; media_type: MediaType };

/**
 * Tonight belongs to the evening and the group, not to a session: starting
 * over keeps what was saved, and another group has its own evening.
 */
export async function getTonight(
  userId: string,
  groupId: string,
  providerIds: number[],
): Promise<Tonight> {
  const supabase = await createClient();
  const since = eveningStart();
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, picked_tmdb_id, picked_media_type, picked_at")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .gte("started_at", since)
    .order("started_at", { ascending: false });
  if (error) throw error;
  if (sessions.length === 0) return { choice: null, saved: [] };

  const picked = sessions
    .filter((s) => s.picked_tmdb_id && s.picked_media_type)
    .sort((a, b) => String(b.picked_at).localeCompare(String(a.picked_at)))[0];
  const choiceRef: Ref | null = picked
    ? {
        tmdb_id: picked.picked_tmdb_id as number,
        media_type: picked.picked_media_type as MediaType,
      }
    : null;

  const [rights, list] = await Promise.all([
    supabase
      .from("interactions")
      .select("tmdb_id, media_type, created_at")
      .eq("user_id", userId)
      .eq("action", "right")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type")
      .eq("user_id", userId)
      .eq("group_id", groupId),
  ]);
  if (rights.error) throw rights.error;
  if (list.error) throw list.error;

  // Still saved for the group: a moved or undone title is not a candidate.
  const onList = new Set(list.data.map(key));
  const savedRefs = [
    ...new Map(
      (rights.data as Ref[])
        .filter((r) => onList.has(key(r)))
        .map((r) => [key(r), r]),
    ).values(),
  ];
  const refs = [...savedRefs, ...(choiceRef ? [choiceRef] : [])];
  if (refs.length === 0) return { choice: null, saved: [] };

  const [rows, genres] = await Promise.all([getTitles(refs), getGenreNames()]);
  const mine = new Set(providerIds);
  const card = (r: Ref) => {
    const row = rows.get(key(r));
    return row ? toCard(row, mine, genres) : null;
  };
  return {
    choice: choiceRef ? card(choiceRef) : null,
    saved: savedRefs.map(card).filter((c): c is Card => c !== null),
  };
}
