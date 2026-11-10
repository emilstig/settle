import "server-only";
import { createClient } from "@/lib/supabase/server";
import { key, toCard, type Card } from "@/lib/deck";
import { eveningStart } from "@/lib/evening";
import { getGenreNames } from "@/lib/tmdb/genres";
import { getTitles, type MediaType } from "@/lib/tmdb/titles";

export { eveningStart };

export type Tonight = {
  /** Tonight's choice for the group, if one is made. */
  choice: Card | null;
  /**
   * What was saved tonight with the group and is still saved: swiped right,
   * added from Att se, or seen with "se igen" for the group.
   */
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
      .select("tmdb_id, media_type, action, created_at")
      .eq("user_id", userId)
      .in("action", ["right", "seen", "undo"])
      .in(
        "session_id",
        sessions.map((s) => s.id),
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("watchlist")
      .select("tmdb_id, media_type, interest")
      .eq("user_id", userId)
      .eq("group_id", groupId),
  ]);
  if (rights.error) throw rights.error;
  if (list.error) throw list.error;

  // Still saved for the group: a moved or undone title is not a candidate,
  // and neither is one taken off tonight ("undo" after the last right swipe).
  // A title seen tonight counts when it got "se igen" with the group: seen
  // and wanted again is saved too. Rows are latest first, so the first row
  // per title decides.
  const interestOf = new Map(
    list.data.map((w) => [key(w), w.interest as string]),
  );
  const latest = new Map<string, Ref & { action: string }>();
  for (const r of rights.data as (Ref & { action: string })[])
    if (!latest.has(key(r))) latest.set(key(r), r);
  const savedRefs = [...latest.values()]
    .filter((r) =>
      r.action === "seen"
        ? interestOf.get(key(r)) === "rewatch"
        : r.action === "right" && interestOf.has(key(r)),
    )
    .map(({ tmdb_id, media_type }) => ({ tmdb_id, media_type }));
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
