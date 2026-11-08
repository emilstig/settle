import Link from "next/link";
import { Suspense } from "react";
import { Attribution } from "@/components/attribution";
import { getCurrentUser } from "@/lib/auth";
import { getGroups } from "@/lib/groups";
import { countRatings } from "@/lib/profile";
import { signOut } from "./actions";
import { Finder } from "./find/finder";
import styles from "./home.module.css";

/** Below this many ratings the profile is thin, so Hitta offers calibration. */
const THIN_PROFILE = 10;

export default function FindPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className="logo">Settle</p>
      </header>
      <Suspense fallback={<div className={styles.loading} aria-busy="true" />}>
        <Find />
      </Suspense>
    </main>
  );
}

async function Find() {
  const user = await getCurrentUser();
  const [groups, ratings] = await Promise.all([
    getGroups(),
    countRatings(user.id),
  ]);

  return (
    <Finder
      groups={groups.map(({ id, name, kind, youngest_age }) => ({
        id,
        name,
        kind,
        youngest_age,
      }))}
      footer={
        <>
          {ratings < THIN_PROFILE && (
            <div className={styles.calCard}>
              <h2>Hjälp appen lära känna dig</h2>
              <p>
                Betygsätt kända titlar du kanske har sett. Det tar ett par
                minuter.
              </p>
              <Link href="/calibrate" className={`primary ${styles.calButton}`}>
                Kalibrera
              </Link>
            </div>
          )}
          <div className={styles.links}>
            <Link href="/profile" className="link">
              Din smakprofil
            </Link>
            <Link href="/onboarding/services" className="link">
              Ändra tjänster
            </Link>
            <form action={signOut}>
              <button className="link">Logga ut</button>
            </form>
          </div>
          <Attribution />
        </>
      }
    />
  );
}
