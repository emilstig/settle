import Link from "next/link";
import { Attribution } from "@/components/attribution";
import { getGroups } from "@/lib/groups";
import { signOut } from "./actions";
import { Finder } from "./find/finder";
import styles from "./home.module.css";

export default async function FindPage() {
  const groups = await getGroups();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className="logo">Settle</p>
      </header>
      <Finder
        groups={groups.map(({ id, name, kind }) => ({ id, name, kind }))}
        footer={
          <>
            <div className={styles.links}>
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
    </main>
  );
}
