"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REGION } from "@/lib/tmdb/client";
import { getSwedishProviders } from "@/lib/tmdb/providers";

export type ServicesState = { error?: string };

const idsSchema = z.array(z.coerce.number().int().positive()).max(50);

export async function saveServices(_: ServicesState, formData: FormData): Promise<ServicesState> {
  const user = await getCurrentUser();
  const parsed = idsSchema.safeParse(formData.getAll("provider"));
  if (!parsed.success) return { error: "Något gick fel. Prova igen." };

  const known = new Set((await getSwedishProviders()).map((p) => p.id));
  const ids = [...new Set(parsed.data)].filter((id) => known.has(id));
  if (ids.length === 0) return { error: "Välj minst en tjänst." };

  const supabase = await createClient();
  const { error: delError } = await supabase
    .from("user_providers")
    .delete()
    .eq("user_id", user.id)
    .eq("region", REGION);
  if (delError) return { error: "Det gick inte att spara. Prova igen." };

  const { error } = await supabase
    .from("user_providers")
    .insert(ids.map((provider_id) => ({ user_id: user.id, provider_id, region: REGION })));
  if (error) return { error: "Det gick inte att spara. Prova igen." };

  redirect(user.onboarded ? "/" : "/onboarding");
}
