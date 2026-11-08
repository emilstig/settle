"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Magic link target. Runs in the browser because the default Supabase email
 * puts the session in the URL fragment, which never reaches the server. Also
 * handles `token_hash` (custom template) and `code` (PKCE) links.
 */
export function ConfirmLink() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { detectSessionInUrl: false } },
    );

    async function confirm() {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));

      const linkError =
        query.get("error_code") ?? hash.get("error_code") ?? query.get("error") ?? hash.get("error");
      if (linkError) throw new Error(linkError);

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const tokenHash = query.get("token_hash");
      const code = query.get("code");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) throw error;
      } else if (tokenHash) {
        const type = (query.get("type") ?? "email") as EmailOtpType;
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) throw error;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else {
        throw new Error("missing_params");
      }
    }

    confirm()
      .then(() => window.location.replace("/"))
      .catch((err) => {
        console.error("Magic link failed:", err);
        setFailed(true);
      });
  }, []);

  if (!failed) return <p style={{ color: "var(--mute)" }}>Loggar in …</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p className="error" role="alert">
        Länken fungerade inte. Den kan ha gått ut eller redan använts.
      </p>
      <a href="/login" className="primary" style={{ textAlign: "center" }}>
        Be om en ny länk
      </a>
    </div>
  );
}
