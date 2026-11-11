"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getGroups } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";

const ref = z.object({
  tmdb_id: z.number().int().positive(),
  media_type: z.enum(["movie", "tv"]),
});
const interest = z.enum(["maybe", "want", "rewatch"]);
const input = z.object({ groupId: z.uuid(), ref });

export type Removed = { interest: z.infer<typeof interest>; addedAt: string };

/** "Ta bort": off the group's list. Returns what it was, for "Ångra". */
export async function removeFromList(
  data: z.infer<typeof input>,
): Promise<Removed | null> {
  const user = await getCurrentUser();
  const { groupId, ref: r } = input.parse(data);
  const supabase = await createClient();
  const match = { user_id: user.id, group_id: groupId, ...r };
  const { data: prev, error } = await supabase
    .from("watchlist")
    .select("interest, added_at")
    .match(match)
    .maybeSingle();
  if (error) throw error;
  if (!prev) return null;
  const { error: delError } = await supabase
    .from("watchlist")
    .delete()
    .match(match);
  if (delError) throw delError;
  return {
    interest: prev.interest as z.infer<typeof interest>,
    addedAt: prev.added_at as string,
  };
}

/**
 * Puts a title on the group's list with the given interest: "Vill gärna",
 * back to "Vill se", or back after "Ta bort" with "Ångra".
 */
export async function setListInterest(
  data: z.infer<typeof input> & {
    interest: z.infer<typeof interest>;
    /** Kept on "Ångra", so the title goes back to its place. */
    addedAt?: string;
  },
) {
  const user = await getCurrentUser();
  const { groupId, ref: r } = input.parse(data);
  const value = interest.parse(data.interest);
  const addedAt = z.iso
    .datetime({ offset: true })
    .optional()
    .parse(data.addedAt);
  const supabase = await createClient();
  const { error } = await supabase.from("watchlist").upsert(
    {
      user_id: user.id,
      group_id: groupId,
      ...r,
      interest: value,
      ...(addedAt ? { added_at: addedAt } : {}),
    },
    { onConflict: "user_id,tmdb_id,media_type,group_id" },
  );
  if (error) throw error;
}

const refInput = z.object({ ref });

/** The groups whose lists a title is on. */
export async function listGroupsFor(
  data: z.infer<typeof refInput>,
): Promise<string[]> {
  const user = await getCurrentUser();
  const { ref: r } = refInput.parse(data);
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("watchlist")
    .select("group_id")
    .match({ user_id: user.id, ...r });
  if (error) throw error;
  return rows.map((w) => w.group_id as string);
}

const groupsInput = z.object({
  ref,
  groupIds: z.array(z.uuid()).min(1).max(10),
});

/**
 * "Med annan grupp" in the detail view: the title ends up on exactly the
 * chosen groups' lists. Added groups get "Vill se"; groups that keep it keep
 * their interest.
 */
export async function setListGroups(data: z.infer<typeof groupsInput>) {
  const user = await getCurrentUser();
  const { ref: r, groupIds } = groupsInput.parse(data);
  const groups = await getGroups();
  const owned = new Set(groups.map((g) => g.id));
  const chosen = new Set(groupIds.filter((id) => owned.has(id)));
  if (chosen.size === 0) throw new Error("No groups");
  // Switched-off groups are not shown in the sheet, so their lists stay.
  const hidden = new Set(groups.filter((g) => g.hidden).map((g) => g.id));
  const before = new Set(
    (await listGroupsFor({ ref: r })).filter((id) => !hidden.has(id)),
  );
  const supabase = await createClient();
  const added = [...chosen].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !chosen.has(id));
  if (added.length) {
    const { error } = await supabase.from("watchlist").insert(
      added.map((group_id) => ({
        user_id: user.id,
        group_id,
        ...r,
        interest: "maybe",
      })),
    );
    if (error) throw error;
  }
  if (removed.length) {
    const { error } = await supabase
      .from("watchlist")
      .delete()
      .match({ user_id: user.id, ...r })
      .in("group_id", removed);
    if (error) throw error;
  }
}
