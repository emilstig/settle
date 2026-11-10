"use client";

import { useRouter } from "next/navigation";
import { BackIcon } from "../find/decision-icons";
import { AppHeader } from "../find/group-picker";
import find from "../find/find.module.css";

/**
 * The header of a page under Profil: a back arrow before the title, like
 * the deck's. Back goes to where the user came from (Profil, or Din smak
 * for Historik), the same as the phone's back gesture.
 */
export function SubHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <AppHeader>
      <button
        type="button"
        className={find.headBack}
        aria-label="Tillbaka"
        onClick={() => {
          // Opened directly, there is nothing in the app to go back to.
          if (window.history.length > 1) router.back();
          else router.push("/profile");
        }}
      >
        <BackIcon />
      </button>
      <h1 className="logo">{title}</h1>
    </AppHeader>
  );
}
