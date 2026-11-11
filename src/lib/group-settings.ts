"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { choosableGroups, getGroups } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";

/**
 * Which groups the user uses. A switched-off group is hidden, never deleted:
 * its lists, ratings and history come back when it is switched on again.
 * Själv is always on.
 */

const idsSchema = z.array(z.uuid()).max(10);

async function setVisible(userId: string, on: Set<string>) {
  const supabase = await createClient();
  for (const g of choosableGroups(await getGroups())) {
    const hidden = !on.has(g.id);
    if (g.hidden === hidden) continue;
    const { error } = await supabase
      .from("groups")
      .update({ hidden })
      .eq("id", g.id)
      .eq("user_id", userId)
      .neq("kind", "solo");
    if (error) throw error;
  }
}

/** Onboarding: "Vem brukar du titta med?", then on to calibration. */
export async function saveGroupChoice(formData: FormData) {
  const user = await getCurrentUser();
  const ids = idsSchema.parse(formData.getAll("group"));
  await setVisible(user.id, new Set(ids));
  if (!user.groupsChosen) {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({
      data: { groups_chosen: true },
    });
    if (error) throw error;
    // Refresh the session so the new metadata is in the token pages read.
    await supabase.auth.refreshSession();
  }
  redirect(user.onboarded ? "/profile/groups" : "/onboarding");
}

/** Profil: one group on or off. */
export async function setGroupOn(input: { groupId: string; on: boolean }) {
  const user = await getCurrentUser();
  const groupId = z.uuid().parse(input.groupId);
  const on = z.boolean().parse(input.on);
  const supabase = await createClient();
  const { error } = await supabase
    .from("groups")
    .update({ hidden: !on })
    .eq("id", groupId)
    .eq("user_id", user.id)
    .neq("kind", "solo");
  if (error) throw error;
  revalidatePath("/", "layout");
}
