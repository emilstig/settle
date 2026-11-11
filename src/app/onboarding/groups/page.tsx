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

async function Choice() {
  const user = await getCurrentUser();
  if (user.onboarded) redirect("/profile/groups");
  const groups = choosableGroups(await getGroups());
  return (
    <form action={saveGroupChoice} className={styles.form}>
      <fieldset className={styles.choices}>
        <legend className="visually-hidden">Vem du brukar titta med</legend>
        {groups.map((g) => (
          <label key={g.id}>
            <input
              type="checkbox"
              name="group"
              value={g.id}
              // Nothing chosen the first time: a choice is a wish, so it is
              // the user's to make. Back here later, it shows what was saved.
              defaultChecked={user.groupsChosen && !g.hidden}
              className="visually-hidden"
            />
            <span className="chip">{g.name}</span>
          </label>
        ))}
      </fieldset>
      <p className={styles.step}>Väljer du ingen tittar du själv.</p>
      <button className="primary">Fortsätt</button>
    </form>
  );
}
