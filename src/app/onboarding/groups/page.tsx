import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { choosableGroups, getGroups } from "@/lib/groups";
import { saveGroupChoice } from "@/lib/group-settings";
import styles from "../onboarding.module.css";

export const metadata: Metadata = { title: "Vem tittar du med?" };

/** Onboarding, after the services: who the user usually watches with. */
export default function GroupsPage() {
  return (
    <main className={styles.main}>
      <p className="logo">Settle</p>
      <h1 className="q">Vem brukar du titta med?</h1>
      <p className={styles.lead}>
        Välj alla som stämmer. Du kan ändra det senare i Profil.
      </p>
      <Suspense fallback={<div className={styles.placeholder} />}>
        <Choice />
      </Suspense>
    </main>
  );
}

const AGES = Array.from({ length: 18 }, (_, i) => i);

/** The line under each name: who it is, since nothing is saved yet. */
const SUB: Record<string, string> = {
  partner: "Ni två",
  family: "Med barn",
  friends: "Fler än två",
};

async function Choice() {
  const user = await getCurrentUser();
  if (user.onboarded) redirect("/profile/groups");
  const groups = await getGroups();
  const solo = groups.find((g) => g.kind === "solo");
  const family = groups.find((g) => g.kind === "family");
  return (
    <form action={saveGroupChoice} className={styles.form}>
      {/* Several choices, so check boxes with a tick, unlike the picker's
          tiles where a filled tile is the one group watching tonight. */}
      <fieldset className={styles.tiles}>
        <legend className="visually-hidden">Vem du brukar titta med</legend>
        {solo && (
          <label className={styles.tile}>
            <input type="checkbox" checked disabled readOnly />
            <span className={styles.tileName}>{solo.name}</span>
            <span className={styles.tileSub}>Alltid med</span>
            <Tick />
          </label>
        )}
        {choosableGroups(groups).map((g) => (
          <label key={g.id} className={styles.tile}>
            <input
              type="checkbox"
              name="group"
              value={g.id}
              data-family={g.kind === "family" || undefined}
              // Nothing chosen the first time: a choice is a wish, so it is
              // the user's to make. Back here later, it shows what was saved.
              defaultChecked={user.groupsChosen && !g.hidden}
            />
            <span className={styles.tileName}>{g.name}</span>
            <span className={styles.tileSub}>{SUB[g.kind] ?? ""}</span>
            <Tick />
          </label>
        ))}
      </fieldset>
      {family && (
        // Shown while Familj is ticked (CSS). Optional: without an answer
        // the start view asks the first time Familj is chosen, and 7 applies.
        <fieldset className={styles.ageQ}>
          <legend>Hur gammal är den yngsta?</legend>
          <p className={styles.step}>
            Vi föreslår bara sådant som passar alla i soffan.
          </p>
          <div className={styles.ages}>
            {AGES.map((age) => (
              <label key={age}>
                <input
                  type="radio"
                  name="age"
                  value={age}
                  defaultChecked={
                    user.groupsChosen && family.youngest_age === age
                  }
                />
                <span className="chip">{age}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button className="primary">Fortsätt</button>
    </form>
  );
}

function Tick() {
  return (
    <span className={styles.tick} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}
