import type { Metadata } from "next";
import { Suspense } from "react";
import { Calibrator } from "@/components/calibrator/calibrator";
import { getCurrentUser } from "@/lib/auth";
import { getCalibrationCards } from "@/lib/calibration";
import { getUserProviderIds } from "@/lib/providers";
import styles from "../home.module.css";

export const metadata: Metadata = { title: "Kalibrera" };

export default function CalibratePage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className="logo">Settle</p>
      </header>
      <Suspense fallback={<p className={styles.wait}>Hämtar kända titlar …</p>}>
        <Calibration />
      </Suspense>
    </main>
  );
}

async function Calibration() {
  const user = await getCurrentUser();
  const cards = await getCalibrationCards(user.id, await getUserProviderIds());
  return <Calibrator cards={cards} mode="app" />;
}
