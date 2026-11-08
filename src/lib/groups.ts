import "server-only";
import { createClient } from "@/lib/supabase/server";

export type GroupKind = "solo" | "partner" | "family" | "friends" | "custom";

export type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  youngest_age: number | null;
  sort: number;
};

/** Used when Familj has no youngest_age, per the domain rules. */
export const DEFAULT_YOUNGEST_AGE = 7;

export async function getGroups(): Promise<Group[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, kind, youngest_age, sort")
    .order("sort");
  if (error) throw error;
  return data as Group[];
}

/** How many titles are on each group's list, by group id. */
export async function countSavedByGroup(
  userId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist")
    .select("group_id")
    .eq("user_id", userId);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data)
    counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  return counts;
}
