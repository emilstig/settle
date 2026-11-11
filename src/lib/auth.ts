import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string | null;
  onboarded: boolean;
  /** Answered "Vem brukar du titta med?" in onboarding. */
  groupsChosen: boolean;
};

/** Reads and verifies the session. Redirects to /login when signed out. */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    onboarded: meta.onboarded === true,
    groupsChosen: meta.groups_chosen === true,
  };
});

/**
 * Checks with the auth server that the account still exists. A session can
 * outlive its account (a test account reset with --fresh, a deleted user):
 * the token still verifies, but every row is gone, so the app would send it
 * to onboarding where nothing can be saved. Then the session is cleared.
 * Costs a request, so it runs only where the app is about to onboard.
 */
export async function requireExistingUser(): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/auth/signout");
}
