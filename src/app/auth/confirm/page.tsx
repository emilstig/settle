import type { Metadata } from "next";
import { ConfirmLink } from "./confirm-link";
import styles from "../../login/login.module.css";

export const metadata: Metadata = { title: "Loggar in" };

export default function ConfirmPage() {
  return (
    <main className={styles.main}>
      <h1 className="q">Settle</h1>
      <ConfirmLink />
    </main>
  );
}
