import "server-only";
import { cookies } from "next/headers";

/**
 * A temporary switch for step 5: the deck without Claude (no reading of the
 * mood, no titles in the style, no Toppval), to compare against. Only for
 * the accounts in COMPARE_EMAILS, and for everyone in development.
 */
export const NO_AI_COOKIE = "settle_no_ai";

export function canCompare(email: string | null): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (!email) return false;
  const allowed = (process.env.COMPARE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/** Whether this user has switched Claude off for new sessions. */
export async function isNoAi(email: string | null): Promise<boolean> {
  if (!canCompare(email)) return false;
  return (await cookies()).get(NO_AI_COOKIE)?.value === "1";
}
