import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Clears the session in this browser and goes to the login page. Server
 * components cannot change cookies, so they redirect here when the session
 * belongs to an account that no longer exists (see requireExistingUser).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", request.url));
}
