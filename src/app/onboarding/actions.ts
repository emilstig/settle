"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ageSchema = z.coerce.number().int().min(0).max(17);

export async function finishOnboarding(formData: FormData) {
  const user = await getCurrentUser();
  const supabase = await createClient();

  if (formData.get("intent") === "save") {
    const age = ageSchema.safeParse(formData.get("youngest_age"));
    if (age.success) {
      const { error } = await supabase
        .from("groups")
        .update({ youngest_age: age.data })
        .eq("user_id", user.id)
        .eq("kind", "family");
      if (error) throw error;
    }
  }

  const { error } = await supabase.auth.updateUser({ data: { onboarded: true } });
  if (error) throw error;
  // Refresh the session so the new metadata is in the token the layout reads.
  await supabase.auth.refreshSession();

  redirect("/");
}
