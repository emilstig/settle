"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { eveningDate, getCheckIns, type CheckIn } from "@/lib/check-in";
import { getGroups } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { recordSeen } from "./find-actions";

/** What the clock has to ask about, for the badge and the sheet. */
export async function checkIns(): Promise<CheckIn[]> {
  const user = await getCurrentUser();
  return getCheckIns(user.id);
}

const rating = z.union([
  z.literal(-1),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
const answerSchema = z.object({
  sessionIds: z.array(z.uuid()).min(1).max(20),
  ref: z.object({
    tmdb_id: z.number().int().positive(),
    media_type: z.enum(["movie", "tv"]),
  }),
  answer: z.discriminatedUnion("kind", [
    /** A film: seen that evening, and how it was. */
    z.object({ kind: z.literal("rating"), rating }),
    /** A series: going on, finished (with a rating if given) or dropped. */
    z.object({
      kind: z.literal("status"),
      status: z.enum(["watching", "finished", "dropped"]),
      rating: rating.nullable(),
    }),
    /** "Såg den inte": nothing is saved but the answer itself. */
    z.object({ kind: z.literal("notSeen") }),
  ]),
});

/**
 * An answer to Efter tittning. A rating is made with the group the choice
 * was made with and marks the title seen that evening, like Sett. A series
 * status is a fact about the user: watching puts it in Fortsätt titta,
 * dropped counts as "avbruten". Either way the question is not asked again.
 */
export async function answerCheckIn(input: z.infer<typeof answerSchema>) {
  const user = await getCurrentUser();
  const { sessionIds, ref, answer } = answerSchema.parse(input);
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, group_id, picked_tmdb_id, picked_media_type, picked_at")
    .eq("user_id", user.id)
    .in("id", sessionIds)
    .order("picked_at", { ascending: false });
  if (error) throw error;
  const latest = sessions.find(
    (s) =>
      s.picked_tmdb_id === ref.tmdb_id &&
      s.picked_media_type === ref.media_type,
  );
  if (!latest) throw new Error("No such choice");

  const match = { user_id: user.id, ...ref };
  const ratingOf =
    answer.kind === "rating"
      ? answer.rating
      : answer.kind === "status"
        ? answer.rating
        : null;
  if (ratingOf !== null) {
    // The group is gone if the session lost it: Själv then.
    const groupId =
      (latest.group_id as string | null) ??
      (await getGroups()).find((g) => g.kind === "solo")!.id;
    await recordSeen({
      sessionId: latest.id as string,
      groupId,
      ref,
      rating: ratingOf,
      rewatchGroupIds: null,
      source: null,
      seenOn: eveningDate(latest.picked_at as string),
    });
  }

  if (answer.kind === "status") {
    const { data: row, error: rowError } = await supabase
      .from("watch_log")
      .select("tmdb_id")
      .match(match)
      .maybeSingle();
    if (rowError) throw rowError;
    const { error: logError } = row
      ? await supabase
          .from("watch_log")
          .update({ status: answer.status })
          .match(match)
      : await supabase
          .from("watch_log")
          .insert({ ...match, status: answer.status });
    if (logError) throw logError;
    // Going on is Fortsätt titta, dropped is not something to see: either
    // way it leaves Vill se and Vill gärna in every group, as Sett does.
    // Se igen stays.
    const { error: wishError } = await supabase
      .from("watchlist")
      .delete()
      .match(match)
      .in("interest", ["maybe", "want"]);
    if (wishError) throw wishError;
  }

  const { error: doneError } = await supabase
    .from("sessions")
    .update({ checked_in_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in(
      "id",
      sessions.map((s) => s.id as string),
    );
  if (doneError) throw doneError;
}

const statusSchema = z.object({
  ref: z.object({
    tmdb_id: z.number().int().positive(),
    media_type: z.literal("tv"),
  }),
  /** "watching" only to take back Slutade with Ångra. */
  status: z.enum(["watching", "finished", "dropped"]),
  rating: rating.nullable(),
  groupId: z.uuid(),
});

/**
 * Klar or Slutade from Fortsätt titta: the series leaves the shelf. Klar
 * comes with "Hur var den?", made with the group in the header.
 */
export async function setSeriesStatus(input: z.infer<typeof statusSchema>) {
  const user = await getCurrentUser();
  const { ref, status, rating: r, groupId } = statusSchema.parse(input);
  const supabase = await createClient();
  if (r !== null)
    await recordSeen({
      sessionId: null,
      groupId,
      ref,
      rating: r,
      rewatchGroupIds: null,
      source: null,
    });
  const { error } = await supabase
    .from("watch_log")
    .update({ status })
    .match({ user_id: user.id, ...ref });
  if (error) throw error;
}
