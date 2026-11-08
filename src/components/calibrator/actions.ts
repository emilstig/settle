"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
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
      .upsert({ ...match, rating, group_id: null }, { onConflict: "user_id,tmdb_id,media_type" }),
    supabase.from("watch_log").upsert(match, { onConflict: "user_id,tmdb_id,media_type", ignoreDuplicates: true }),
  ]);
  if (r.error) throw r.error;
  if (w.error) throw w.error;
}

/**
 * Undoes a calibration rating. Calibration only shows titles with no rating
 * and no watch log, so removing both restores the state before the swipe.
 */
export async function undoCalibration(input: z.input<typeof refSchema>) {
  const ref = refSchema.parse(input);
  const user = await getCurrentUser();
  const supabase = await createClient();
  const match = { user_id: user.id, ...ref };

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
    const { error } = await supabase.auth.updateUser({ data: { onboarded: true } });
    if (error) throw error;
    // Refresh the session so the new metadata is in the token the layout reads.
    await supabase.auth.refreshSession();
  }
  redirect("/");
}
