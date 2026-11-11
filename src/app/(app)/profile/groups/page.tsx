import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { choosableGroups, getGroups } from "@/lib/groups";
import home from "../../home.module.css";
import { SubHeader } from "../sub-header";
import styles from "../profile.module.css";
import { GroupSwitches } from "./group-switches";

export const metadata: Metadata = { title: "Grupper" };

/**
 * Grupper: which groups the user uses, and the age for Familj. Själv is
 * always on and not a choice. Names, filters and new groups come after MVP.
 */
export default function GroupsPage() {
  return (
    <main className={home.main}>
      <SubHeader title="Grupper" />
      <p className={styles.lead}>
        Vem brukar du titta med? Grupper du stänger av döljs, men listor och
        betyg finns kvar om du slår på dem igen.
      </p>
      <Suspense fallback={<p className={home.wait}>Hämtar dina grupper …</p>}>
        <Groups />
      </Suspense>
    </main>
  );
}

async function Groups() {
  await getCurrentUser();
  const groups = choosableGroups(await getGroups());
  return (
    <GroupSwitches
      groups={groups.map(({ id, name, kind, youngest_age, hidden }) => ({
        id,
        name,
        family: kind === "family",
        age: youngest_age,
        on: !hidden,
      }))}
    />
  );
}
