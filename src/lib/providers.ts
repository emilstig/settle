import "server-only";
import { createClient } from "@/lib/supabase/server";
import { REGION } from "@/lib/tmdb/client";

/** The user's selected streaming services (TMDB provider ids) in Sweden. */
export async function getUserProviderIds(): Promise<number[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_providers")
    .select("provider_id")
    .eq("region", REGION);
  if (error) throw error;
  return data.map((r) => r.provider_id as number);
}
