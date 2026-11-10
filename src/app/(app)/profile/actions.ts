"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getGroups } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";

/**
 * What the detail view in Historik can change: the rating, se igen, "Inte
 * sett" and "Inte min grej". Each returns what it needs for "Ångra".
 */

const ref = z.object({
  tmdb_id: z.number().int().positive(),
  media_type: z.enum(["movie", "tv"]),
});
type Ref = z.infer<typeof ref>;
const rating = z.union([
  z.literal(-1),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const ratingInput = z.object({ ref, rating });

/**
 * A new rating from Historik. A rating made with a group stays that group's,
 * so it keeps counting where it was said; a new one is the user's own.
 */
export async function setHistoryRating(data: z.infer<typeof ratingInput>) {
  const user = await getCurrentUser();
  const { ref: r, rating: value } = ratingInput.parse(data);
  const supabase = await createClient();
  const match = { user_id: user.id, ...r };
  const { data: prev, error } = await supabase
    .from("ratings")
    .select("group_id")
    .match(match)
    .maybeSingle();
  if (error) throw error;
  const { error: upError } = await supabase
    .from("ratings")
    .upsert(
      { ...match, rating: value, group_id: prev?.group_id ?? null },
      { onConflict: "user_id,tmdb_id,media_type" },
    );
  if (upError) throw upError;
}

const refInput = z.object({ ref });
const ratingRow = z.object({
  rating: z.number().int(),
  group_id: z.uuid().nullable(),
});
const logRow = z.object({
  times_seen: z.enum(["once", "few", "many"]).nullable(),
  last_seen: z.iso.date().nullable(),
  last_seen_approx: z.enum(["recent", "this_year", "long_ago"]).nullable(),
  status: z.enum(["watching", "finished", "dropped"]).nullable(),
});

export type Forgotten = {
  rating: z.infer<typeof ratingRow> | null;
  log: z.infer<typeof logRow> | null;
};

/**
 * "Inte sett": the title was never seen after all (a slip in calibration,
 * say). The watch log row and the rating go, so it can be suggested again.
 */
export async function forgetSeen(
  data: z.infer<typeof refInput>,
): Promise<Forgotten> {
  const user = await getCurrentUser();
  const { ref: r } = refInput.parse(data);
  const supabase = await createClient();
  const match = { user_id: user.id, ...r };
  const [prevRating, prevLog] = await Promise.all([
    supabase
      .from("ratings")
      .select("rating, group_id")
      .match(match)
      .maybeSingle(),
    supabase
      .from("watch_log")
      .select("times_seen, last_seen, last_seen_approx, status")
      .match(match)
      .maybeSingle(),
  ]);
  if (prevRating.error) throw prevRating.error;
  if (prevLog.error) throw prevLog.error;
  for (const table of ["ratings", "watch_log"] as const) {
    const { error } = await supabase.from(table).delete().match(match);
    if (error) throw error;
  }
  return {
    rating: prevRating.data ?? null,
    log: (prevLog.data as Forgotten["log"]) ?? null,
  };
}

const restoreInput = z.object({
  ref,
  rating: ratingRow.nullable(),
  log: logRow.nullable(),
});

/** "Ångra" after "Inte sett". */
export async function restoreSeen(data: z.infer<typeof restoreInput>) {
  const user = await getCurrentUser();
  const { ref: r, rating: prevRating, log } = restoreInput.parse(data);
  const supabase = await createClient();
  const match = { user_id: user.id, ...r };
  if (log) {
    const { error } = await supabase
      .from("watch_log")
      .upsert(
        { ...match, ...log },
        { onConflict: "user_id,tmdb_id,media_type" },
      );
    if (error) throw error;
  }
  if (prevRating) {
    const { error } = await supabase
      .from("ratings")
      .upsert(
        { ...match, ...prevRating },
        { onConflict: "user_id,tmdb_id,media_type" },
      );
    if (error) throw error;
  }
}

const rewatchInput = z.object({
  ref,
  groupIds: z.array(z.uuid()).min(1).max(10),
});

/**
 * "Se igen med …" after the fact: on the chosen groups' lists as se igen,
 * which takes the title to Att se om. Returns the groups that got it.
 */
export async function setHistoryRewatch(
  data: z.infer<typeof rewatchInput>,
): Promise<string[]> {
  const user = await getCurrentUser();
  const { ref: r, groupIds } = rewatchInput.parse(data);
  const owned = new Set((await getGroups()).map((g) => g.id));
  const chosen = [...new Set(groupIds)].filter((id) => owned.has(id));
  if (chosen.length === 0) throw new Error("No groups");
  const supabase = await createClient();
  const { error } = await supabase.from("watchlist").upsert(
    chosen.map((group_id) => ({
      user_id: user.id,
      group_id,
      ...r,
      interest: "rewatch",
    })),
    { onConflict: "user_id,tmdb_id,media_type,group_id" },
  );
  if (error) throw error;
  return chosen;
}

const unRewatchInput = z.object({ ref, groupIds: z.array(z.uuid()).max(10) });

/** "Ångra" after se igen: off those lists again. */
export async function undoHistoryRewatch(data: z.infer<typeof unRewatchInput>) {
  const user = await getCurrentUser();
  const { ref: r, groupIds } = unRewatchInput.parse(data);
  if (groupIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .match({ user_id: user.id, ...r })
    .in("group_id", groupIds);
  if (error) throw error;
}

const liftInput = z.object({ ref, groupId: z.uuid() });

async function notForMeIds(userId: string, r: Ref, groupId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .select("id, sessions!inner(group_id)")
    .match({ user_id: userId, ...r, action: "left", reason: "not_for_me" })
    .eq("sessions.group_id", groupId);
  if (error) throw error;
  return data.map((i) => i.id as number);
}

async function setReason(ids: number[], reason: "not_now" | "not_for_me") {
  if (ids.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("interactions")
    .update({ reason })
    .in("id", ids);
  if (error) throw error;
}

/**
 * Lifts "Inte min grej" with a group: the swipes become "Inte nu", so the
 * title can be suggested in the group again and no longer counts against
 * its genres. Returns the swipes changed, for "Ångra".
 */
export async function liftNotForMe(
  data: z.infer<typeof liftInput>,
): Promise<number[]> {
  const user = await getCurrentUser();
  const { ref: r, groupId } = liftInput.parse(data);
  const ids = await notForMeIds(user.id, r, groupId);
  await setReason(ids, "not_now");
  return ids;
}

/** "Ångra" after lifting "Inte min grej". */
export async function restoreNotForMe(data: { ids: number[] }) {
  await getCurrentUser();
  const ids = z.array(z.number().int()).max(500).parse(data.ids);
  // RLS keeps this to the user's own rows.
  await setReason(ids, "not_for_me");
}
