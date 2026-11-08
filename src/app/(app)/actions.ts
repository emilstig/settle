"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const ageSchema = z.object({ groupId: z.uuid(), age: z.number().int().min(0).max(17) });

/** Asked the first time Familj is picked: the youngest child sets the age limit. */
export async function setYoungestAge(input: { groupId: string; age: number }) {
  const { groupId, age } = ageSchema.parse(input);
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("groups")
    .update({ youngest_age: age })
    .eq("id", groupId)
    .eq("user_id", user.id)
    .eq("kind", "family");
  if (error) throw error;
}
