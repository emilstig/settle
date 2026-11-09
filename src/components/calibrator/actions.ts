"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getCalibrationCards } from "@/lib/calibration";
import type { Card } from "@/lib/deck";
import { createClient } from "@/lib/supabase/server";

const refSchema = z.object({
  tmdb_id: z.number().int().positive(),
  media_type: z.enum(["movie", "tv"]),
});
const rateSchema = z.object({
  ref: refSchema,
  // Calibration has three answers: ogillade, gillar, älskar.
  rating: z.union([z.literal(-1), z.literal(1), z.literal(3)]),
});

/** A calibration rating is personal (no group) and marks the title as seen. */
export async function rateCalibration(input: z.input<typeof rateSchema>) {
  const { ref, rating } = rateSchema.parse(input);
  const user = await getCurrentUser();
  const supabase = await createClient();
  const match = { user_id: user.id, ...ref };

  const [r, w] = await Promise.all([
    supabase
      .from("ratings")
      .upsert(
        { ...match, rating, group_id: null },
        { onConflict: "user_id,tmdb_id,media_type" },
      ),
    supabase.from("watch_log").upsert(match, {
      onConflict: "user_id,tmdb_id,media_type",
      ignoreDuplicates: true,
    }),
  ]);
  if (r.error) throw r.error;
  if (w.error) throw w.error;
}

/** "Inte sett": remembered so the next calibration shows other titles. */
export async function markNotSeen(
  input: z.input<typeof refSchema>,
): Promise<number> {
  const ref = refSchema.parse(input);
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .insert({ user_id: user.id, ...ref, action: "not_seen" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

const undoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rating"), ref: refSchema }),
  z.object({
    kind: z.literal("not_seen"),
    interactionId: z.number().int().positive(),
  }),
]);
export type CalibrationUndo = z.infer<typeof undoSchema>;

/**
 * Undoes one calibration swipe. Calibration only shows titles with no rating
 * and no watch log, so removing both restores the state before a rating.
 */
export async function undoCalibration(input: CalibrationUndo) {
  const undo = undoSchema.parse(input);
  const user = await getCurrentUser();
  const supabase = await createClient();

  if (undo.kind === "not_seen") {
    const { error } = await supabase
      .from("interactions")
      .delete()
      .eq("id", undo.interactionId)
      .eq("user_id", user.id);
    if (error) throw error;
    return;
  }

  const match = { user_id: user.id, ...undo.ref };
  const [r, w] = await Promise.all([
    supabase.from("ratings").delete().match(match),
    supabase.from("watch_log").delete().match(match),
  ]);
  if (r.error) throw r.error;
  if (w.error) throw w.error;
}

/** Ends calibration. During onboarding it also marks the user as onboarded. */
export async function finishCalibration(mode: "onboarding" | "app") {
  if (mode === "onboarding") {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({
      data: { onboarded: true },
    });
    if (error) throw error;
    // Refresh the session so the new metadata is in the token the layout reads.
    await supabase.auth.refreshSession();
  }
  redirect("/");
}

const skippedSchema = z
  .array(z.string().regex(/^(movie|tv):\d+$/))
  .max(1000);

/**
 * "Fortsätt kalibrera": the next titles, skipping everything already answered
 * and what was passed over with "Hoppa över" in this calibration.
 */
export async function moreCalibrationCards(
  skipped: string[] = [],
): Promise<Card[]> {
  const keys = skippedSchema.parse(skipped);
  const user = await getCurrentUser();
  return getCalibrationCards(user.id, keys);
}
