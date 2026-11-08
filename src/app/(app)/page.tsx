import Link from "next/link";
import { Suspense } from "react";
import { Attribution } from "@/components/attribution";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_YOUNGEST_AGE, getGroups } from "@/lib/groups";
import { signOut } from "./actions";
import { TitleList } from "./title-list";
import styles from "./home.module.css";

export default async function HomePage() {
  const [user, groups] = await Promise.all([getCurrentUser(), getGroups()]);
  const family = groups.find((g) => g.kind === "family");

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className="logo">Settle</p>
        <form action={signOut}>
          <button className="link">Logga ut</button>
        </form>
      </header>

      <h1 className={`q ${styles.title}`}>Vem tittar ikväll?</h1>
      <ul className="chips">
        {groups.map((g) => (
          <li key={g.id} className="chip">
            {g.name}
          </li>
        ))}
      </ul>
      {family && (
        <p className={styles.meta}>
          Familj: yngsta är {family.youngest_age ?? DEFAULT_YOUNGEST_AGE} år
          {family.youngest_age == null ? " (standard)" : ""}.
        </p>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>Populärt på dina tjänster</h2>
          <Link href="/onboarding/services" className="link">
            Ändra tjänster
          </Link>
        </div>
        <Suspense fallback={<p className={styles.meta}>Hämtar titlar …</p>}>
          <TitleList />
        </Suspense>
      </section>

      <footer className={styles.footer}>
        <p className={styles.meta}>Inloggad som {user.email}. Swipen kommer i steg 3.</p>
        <Attribution />
      </footer>
    </main>
  );
}
