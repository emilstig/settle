import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Logga in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className={styles.main}>
      <div className={styles.brand}>
        <h1 className={styles.logo}>Settle</h1>
        <p className={styles.tagline}>Hitta något att se, snabbare.</p>
      </div>
      <Suspense fallback={null}>
        <LoginError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </main>
  );
}

async function LoginError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (error !== "link") return null;
  return (
    <p className={styles.error} role="alert">
      Länken fungerade inte. Den kan ha gått ut eller redan använts. Be om en ny.
    </p>
  );
}
