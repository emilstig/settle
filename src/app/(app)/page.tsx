import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_YOUNGEST_AGE, getGroups } from "@/lib/groups";
import { signOut } from "./actions";
import styles from "./home.module.css";

export default async function HomePage() {
  const [user, groups] = await Promise.all([getCurrentUser(), getGroups()]);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.logo}>Settle</h1>
        <form action={signOut}>
          <button className={styles.link}>Logga ut</button>
        </form>
      </header>

      <section className={styles.section}>
        <h2 className={styles.heading}>Vem tittar?</h2>
        <ul className={styles.groups}>
          {groups.map((g) => (
            <li key={g.id} className={styles.group}>
              <span>{g.name}</span>
              {g.kind === "family" && (
                <span className={styles.meta}>
                  Yngsta {g.youngest_age ?? DEFAULT_YOUNGEST_AGE} år
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.note}>Inloggad som {user.email}. Swipen kommer i nästa steg.</p>
    </main>
  );
}
