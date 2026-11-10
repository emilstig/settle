import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Attribution } from "@/components/attribution";
import { getCurrentUser } from "@/lib/auth";
import { buildProfile } from "@/lib/profile";
import { signOut } from "../actions";
import { AppHeader } from "../find/group-picker";
import home from "../home.module.css";
import styles from "./profile.module.css";

export const metadata: Metadata = { title: "Din smakprofil" };

/** Shows the text that becomes {{PROFILE}} in prompt 2, so it can be checked by eye. */
export default function ProfilePage() {
  return (
    <main className={home.main}>
      {/* A tab of its own: no way back needed, and no group, since the
          profile is the user's and not the company's. */}
      <AppHeader>
        <h1 className="logo">Profil</h1>
      </AppHeader>
      <h2 className="q">Det här har appen lärt sig</h2>
      <Suspense fallback={<p className={styles.lead}>Läser din smak …</p>}>
        <Profile />
      </Suspense>
      <Link href="/calibrate" className={`primary ${styles.button}`}>
        Kalibrera
      </Link>
      <footer className={styles.footer}>
        <div className={home.links}>
          <Link href="/onboarding/services" className="link">
            Ändra tjänster
          </Link>
          <form action={signOut}>
            <button className="link">Logga ut</button>
          </form>
        </div>
        <p className="logo" aria-hidden="true">
          Settle
        </p>
        <Attribution />
      </footer>
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
