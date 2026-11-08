import type { Metadata } from "next";
import { Suspense } from "react";
import { Attribution } from "@/components/attribution";
import { getCurrentUser } from "@/lib/auth";
import { getUserProviderIds } from "@/lib/providers";
import { getSwedishProviders } from "@/lib/tmdb/providers";
import { ServicesForm } from "./services-form";
import styles from "../onboarding.module.css";

export const metadata: Metadata = { title: "Dina tjänster" };

const VISIBLE = 16;

export default function ServicesPage() {
  return (
    <main className={styles.main}>
      <p className="logo">Settle</p>
      <h1 className="q">Vilka tjänster har du?</h1>
      <p className={styles.lead}>Vi föreslår bara sådant som finns att streama på dem.</p>
      <Suspense fallback={<div className={styles.placeholder} />}>
        <Services />
      </Suspense>
      <Attribution />
    </main>
  );
}

async function Services() {
  await getCurrentUser();
  const [all, selected] = await Promise.all([getSwedishProviders(), getUserProviderIds()]);
  const chosen = new Set(selected);
  const top = all.filter((p, i) => i < VISIBLE || chosen.has(p.id));
  const rest = all.filter((p, i) => i >= VISIBLE && !chosen.has(p.id));
  return <ServicesForm top={top} rest={rest} selected={selected} />;
}
