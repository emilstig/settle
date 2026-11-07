import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_YOUNGEST_AGE, getGroups } from "@/lib/groups";
import { finishOnboarding } from "./actions";
import styles from "./onboarding.module.css";

export const metadata: Metadata = { title: "Kom igång" };

const AGES = Array.from({ length: 18 }, (_, i) => i);

export default function OnboardingPage() {
  return (
    <main className={styles.main}>
      <p className={styles.step}>Kom igång</p>
      <h1 className={styles.title}>Hur gammalt är det yngsta barnet?</h1>
      <p className={styles.lead}>
        När du väljer Familj föreslår vi bara sådant som passar alla i soffan. Har du inga barn kan
        du hoppa över det här.
      </p>
      <Suspense fallback={<div className={styles.placeholder} />}>
        <AgeForm />
      </Suspense>
    </main>
  );
}

async function AgeForm() {
  const user = await getCurrentUser();
  if (user.onboarded) redirect("/");

  const family = (await getGroups()).find((g) => g.kind === "family");
  const current = family?.youngest_age ?? DEFAULT_YOUNGEST_AGE;

  return (
    <form action={finishOnboarding} className={styles.form}>
      <label className={styles.label} htmlFor="youngest_age">
        Yngsta barnets ålder
      </label>
      <select
        id="youngest_age"
        name="youngest_age"
        className={styles.select}
        defaultValue={current}
      >
        {AGES.map((age) => (
          <option key={age} value={age}>
            {age === 1 ? "1 år" : `${age} år`}
          </option>
        ))}
      </select>
      <button className={styles.primary} name="intent" value="save">
        Fortsätt
      </button>
      <button className={styles.secondary} name="intent" value="skip" formNoValidate>
        Hoppa över
      </button>
    </form>
  );
}
