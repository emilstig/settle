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
      <p className="logo">Settle</p>
      <h1 className="q">Hur gammalt är det yngsta barnet?</h1>
      <p className={styles.lead}>
        När ni tittar som Familj föreslår vi bara sådant som passar alla i soffan. Har du inga barn
        kan du hoppa över det här.
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
      <fieldset className={styles.fieldset}>
        <legend className="visually-hidden">Yngsta barnets ålder i år</legend>
        <div className={styles.ages}>
          {AGES.map((age) => (
            <label key={age}>
              <input
                type="radio"
                name="youngest_age"
                value={age}
                defaultChecked={age === current}
                className="visually-hidden"
              />
              <span className="chip">{age}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className={styles.step}>Ålder i år. Du kan ändra det senare.</p>
      <div className={styles.actions}>
        <button className="primary" name="intent" value="save">
          Fortsätt
        </button>
        <button className="link" name="intent" value="skip" formNoValidate>
          Hoppa över
        </button>
      </div>
    </form>
  );
}
