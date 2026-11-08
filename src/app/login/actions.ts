"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { step: "email"; error?: string; email?: string }
  | { step: "code"; email: string; error?: string };

const emailSchema = z.email();
const codeSchema = z.string().regex(/^\d{6,10}$/);

async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${proto}://${host}`;
}

export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get("intent");

  if (intent === "restart") return { step: "email" };

  if (intent === "send") {
    const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
    if (!parsed.success) return { step: "email", error: "Skriv en giltig e-postadress." };

    // Implicit flow: the link carries the session itself, so it works in any
    // browser or mail app, not only the one that asked for it.
    const supabase = createPlainClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { shouldCreateUser: true, emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
    });
    if (error) {
      return {
        step: "email",
        email: parsed.data,
        error:
          error.status === 429
            ? "För många försök. Vänta en minut och prova igen."
            : "Det gick inte att skicka mejlet. Prova igen.",
      };
    }
    return { step: "code", email: parsed.data };
  }

  if (intent === "verify" && prev.step === "code") {
    const token = String(formData.get("code") ?? "").replace(/\s/g, "");
    if (!codeSchema.safeParse(token).success) {
      return { ...prev, error: "Koden består av siffror från mejlet." };
    }
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ email: prev.email, token, type: "email" });
    if (error) return { ...prev, error: "Koden stämmer inte eller har gått ut." };
    redirect("/");
  }

  return prev;
}
