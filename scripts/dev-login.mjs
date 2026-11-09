// Prints a one-time login link for a local test account, without sending any email.
// Run: node --env-file=.env.local scripts/dev-login.mjs [origin]
// Default origin is http://localhost:3000. Only localhost origins are accepted.
//
// The test account is created (confirmed) the first time. It is a separate
// account with its own data, never a real user's.
import { createClient } from "@supabase/supabase-js";

const TEST_EMAIL = process.env.DEV_LOGIN_EMAIL ?? "settle-dev@example.com";
const origin = new URL(process.argv[2] ?? "http://localhost:3000");

if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
  console.error(`Refusing ${origin.origin}: dev login only works against localhost.`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (use --env-file=.env.local).");
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Create the account first: for an unknown email, generateLink makes a signup
// token that does not verify as a magic link.
const created = await admin.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true });
if (created.error && created.error.code !== "email_exists") {
  console.error("Could not create test user:", created.error.message);
  process.exit(1);
}
if (!created.error) console.error(`Created test user ${TEST_EMAIL}`);

const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: TEST_EMAIL });
if (error) {
  console.error("Could not generate link:", error.message);
  process.exit(1);
}

const link = new URL("/auth/confirm", origin);
link.searchParams.set("token_hash", data.properties.hashed_token);
link.searchParams.set("type", "magiclink");
console.log(link.href);
