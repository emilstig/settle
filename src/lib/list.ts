import "server-only";
import { key, toCard, type Card } from "@/lib/deck";
import { createClient } from "@/lib/supabase/server";
import { getGenreNames } from "@/lib/tmdb/genres";
import { getTitles, streamingProviders } from "@/lib/tmdb/titles";

/** Titles whose services are fetched again per page load (see getTitles). */
const MAX_REFRESH = 40;

export type ListItem = Card & {
  interest: "maybe" | "want" | "rewatch";
  /** When it was saved, for sorting by latest. */
  addedAt: string;
  /** On one of the user's services right now. */
  available: boolean;
  /** Where else it streams in Sweden, for "Finns på …" when not available. */
  elsewhere: string[];
};

/**
 * The group's list for Att se: everything saved as Vill gärna, Vill se or
 * Se igen, newest first, as cards. Saved titles are never hidden when they
 * leave a service; they are marked instead.
 */
export async function getList(
  userId: string,
  groupId: string,
  providerIds: number[],
): Promise<ListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist")
    .select("tmdb_id, media_type, interest, added_at")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  if (data.length === 0) return [];

  const [rows, genres] = await Promise.all([
    getTitles(data, { maxRefresh: MAX_REFRESH }),
    getGenreNames(),
  ]);
  const mine = new Set(providerIds);
  return data.flatMap((w) => {
    const row = rows.get(key(w));
    if (!row) return [];
    const streams = streamingProviders(row.providers_se);
    return [
      {
        ...toCard(row, mine, genres),
        interest: w.interest as ListItem["interest"],
        addedAt: w.added_at as string,
        available: streams.some((p) => mine.has(p.id)),
        elsewhere: streams.filter((p) => !mine.has(p.id)).map((p) => p.name),
      },
    ];
  });
}
