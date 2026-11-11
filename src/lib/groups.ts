import "server-only";
import { createClient } from "@/lib/supabase/server";

export type GroupKind = "solo" | "partner" | "family" | "friends" | "custom";

export type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  youngest_age: number | null;
  sort: number;
  /** Switched off by the user: hidden in the app, nothing deleted. */
  hidden: boolean;
};

/** Used when Familj has no youngest_age, per the domain rules. */
export const DEFAULT_YOUNGEST_AGE = 7;

/** All the user's groups, switched-off ones too (for ownership checks). */
export async function getGroups(): Promise<Group[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, kind, youngest_age, sort, hidden")
    .order("sort");
  if (error) throw error;
  return data as Group[];
}

/**
 * The groups the user uses: what the app shows and lets them choose. Själv
 * is always among them, and first.
 */
export async function getVisibleGroups(): Promise<Group[]> {
  return (await getGroups()).filter((g) => g.kind === "solo" || !g.hidden);
}

/** The groups that can be switched on and off: all but Själv. */
export function choosableGroups(groups: Group[]): Group[] {
  return groups.filter((g) => g.kind !== "solo");
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
