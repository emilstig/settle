import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Calibrator } from "@/components/calibrator/calibrator";
import { getCurrentUser } from "@/lib/auth";
import { getCalibrationCards } from "@/lib/calibration";
import { getUserProviderIds } from "@/lib/providers";
import styles from "./onboarding.module.css";

export const metadata: Metadata = { title: "Kom igång" };

/** Last onboarding step: calibrate the taste profile, or skip it. */
export default function OnboardingPage() {
  return (
    <main className={styles.main}>
      <p className="logo">Settle</p>
      <Suspense fallback={<p className={styles.step}>Hämtar kända titlar …</p>}>
        <Calibration />
      </Suspense>
    </main>
  );
}

async function Calibration() {
  const user = await getCurrentUser();
  if (user.onboarded) redirect("/");
  // Services come first: the deck in Hitta needs them, even though
  // calibration itself shows titles from every service.
  if ((await getUserProviderIds()).length === 0) redirect("/onboarding/services");
  if (!user.groupsChosen) redirect("/onboarding/groups");

  const cards = await getCalibrationCards(user.id);
  return <Calibrator cards={cards} mode="onboarding" />;
}
