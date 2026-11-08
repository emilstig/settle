import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { buildProfile } from "@/lib/profile";
import home from "../home.module.css";
import styles from "./profile.module.css";

export const metadata: Metadata = { title: "Din smakprofil" };

/** Shows the text that becomes {{PROFILE}} in prompt 2, so it can be checked by eye. */
export default function ProfilePage() {
  return (
    <main className={home.main}>
      <header className={home.header}>
        <p className="logo">Settle</p>
        <Link href="/" className="link">
          Tillbaka
        </Link>
      </header>
      <h1 className="q">Det här har appen lärt sig</h1>
      <Suspense fallback={<p className={styles.lead}>Läser din smak …</p>}>
        <Profile />
      </Suspense>
      <Link href="/calibrate" className={`primary ${styles.button}`}>
        Kalibrera
      </Link>
    </main>
  );
}

async function Profile() {
  const user = await getCurrentUser();
  const profile = await buildProfile(user.id);
  return (
    <>
      <p className={styles.lead}>
        Så här beskrivs din smak när Settle väljer förslag. Den bygger på{" "}
        {profile.ratingCount} egna betyg, från kalibreringen och när du tittar
        själv.
        {profile.groupRatingCount > 0 &&
          ` ${profile.groupRatingCount} betyg med andra grupper räknas som gruppernas historik.`}
      </p>
      <pre className={styles.profile}>{profile.text}</pre>
    </>
  );
}
