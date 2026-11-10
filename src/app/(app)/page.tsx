import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getChosenGroupId } from "@/lib/group-choice";
import { countSavedByGroup, getGroups } from "@/lib/groups";
import { countRatings } from "@/lib/profile";
import { Finder } from "./find/finder";
import styles from "./home.module.css";

/** Below this many ratings the profile is thin, so the start view offers calibration. */
const THIN_PROFILE = 10;

export default function FindPage() {
  return (
    <main className={styles.main}>
      {/* The header is the Finder's: who is watching and Ikväll. */}
      <Suspense fallback={<div className={styles.loading} aria-busy="true" />}>
        <Find />
      </Suspense>
    </main>
  );
}

async function Find() {
  const user = await getCurrentUser();
  const [groups, ratings, saved] = await Promise.all([
    getGroups(),
    countRatings(user.id),
    countSavedByGroup(user.id),
  ]);
  const groupId = await getChosenGroupId(groups);

  return (
    <Finder
      initialGroupId={groupId}
      groups={groups.map(({ id, name, kind, youngest_age }) => ({
        id,
        name,
        kind,
        youngest_age,
        savedCount: saved.get(id) ?? 0,
      }))}
      belowStart={
        ratings < THIN_PROFILE && (
          <Link href="/calibrate" className="secondary">
            Fortsätt kalibrera
          </Link>
        )
      }
    />
  );
}
