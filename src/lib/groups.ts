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
