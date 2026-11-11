import "server-only";
import { key } from "@/lib/deck";
import { eveningStart } from "@/lib/evening";
import { createClient } from "@/lib/supabase/server";
import { getTitles, type MediaType } from "@/lib/tmdb/titles";

/** How far back the clock asks: a choice older than this is let go. */
const ASK_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const WEEKDAYS = [
  "i söndags",
  "i måndags",
  "i tisdags",
  "i onsdags",
  "i torsdags",
  "i fredags",
  "i lördags",
];

export type CheckIn = {
  /** Every session that chose this title; the answer closes them all. */
  sessionIds: string[];
  /** The group it was chosen with, which a rating is made with. */
  groupId: string | null;
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  poster_path: string | null;
  /** "igår", or the weekday ("i tisdags") for an earlier evening. */
  when: string;
};

/**
 * Efter tittning: the choices of earlier evenings (the last week, not
 * tonight) that have not been answered. A choice is answered by the clock,
 * or already by the user: a rating, Sett or a series status given after it
 * was chosen. Latest first, one question per title.
 */
export async function getCheckIns(
  userId: string,
  now = new Date(),
): Promise<CheckIn[]> {
  const supabase = await createClient();
  const tonight = eveningStart(now);
  const since = new Date(Date.parse(tonight) - ASK_DAYS * DAY_MS).toISOString();
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, group_id, picked_tmdb_id, picked_media_type, picked_at")
    .eq("user_id", userId)
    .not("picked_tmdb_id", "is", null)
    .is("checked_in_at", null)
    .gte("picked_at", since)
    .lt("picked_at", tonight)
    .order("picked_at", { ascending: false });
  if (error) throw error;
  if (sessions.length === 0) return [];

  type Pick = {
    sessionIds: string[];
    groupId: string | null;
    tmdb_id: number;
    media_type: MediaType;
    pickedAt: string;
  };
  const picks = new Map<string, Pick>();
  for (const s of sessions) {
    const ref = {
      tmdb_id: s.picked_tmdb_id as number,
      media_type: s.picked_media_type as MediaType,
    };
    const prev = picks.get(key(ref));
    if (prev) prev.sessionIds.push(s.id as string);
    else
      picks.set(key(ref), {
        ...ref,
        sessionIds: [s.id as string],
        groupId: s.group_id as string | null,
        pickedAt: s.picked_at as string,
      });
  }

  const ids = [...new Set([...picks.values()].map((p) => p.tmdb_id))];
  const [ratings, log] = await Promise.all([
    supabase
      .from("ratings")
      .select("tmdb_id, media_type, updated_at")
      .eq("user_id", userId)
      .in("tmdb_id", ids),
    supabase
      .from("watch_log")
      .select("tmdb_id, media_type, updated_at")
      .eq("user_id", userId)
      .in("tmdb_id", ids),
  ]);
  if (ratings.error) throw ratings.error;
  if (log.error) throw log.error;
  const answered = new Map<string, number>();
  for (const r of [...ratings.data, ...log.data]) {
    const at = Date.parse(r.updated_at as string);
    answered.set(key(r), Math.max(at, answered.get(key(r)) ?? 0));
  }

  const open = [...picks.values()].filter(
    (p) => (answered.get(key(p)) ?? 0) < Date.parse(p.pickedAt),
  );
  if (open.length === 0) return [];
  const rows = await getTitles(open);
  const yesterday = new Date(Date.parse(tonight) - DAY_MS).toISOString();
  return open.flatMap((p) => {
    const row = rows.get(key(p));
    if (!row) return [];
    const evening = eveningStart(new Date(p.pickedAt));
    return [
      {
        sessionIds: p.sessionIds,
        groupId: p.groupId,
        tmdb_id: p.tmdb_id,
        media_type: p.media_type,
        title: row.title,
        poster_path: row.poster_path,
        when:
          evening === yesterday
            ? "igår"
            : WEEKDAYS[weekdayInStockholm(new Date(p.pickedAt))],
      },
    ];
  });
}

/** The evening's weekday in Sweden: a choice after midnight is the day before. */
function weekdayInStockholm(at: Date): number {
  const evening = new Date(Date.parse(eveningStart(at)) + 12 * 3600 * 1000);
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
  }).format(evening);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** The date of the evening the choice was made, for last_seen. */
export function eveningDate(pickedAt: string): string {
  const evening = new Date(
    Date.parse(eveningStart(new Date(pickedAt))) + 12 * 3600 * 1000,
  );
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
  }).format(evening);
}
