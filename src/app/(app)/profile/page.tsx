import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Attribution } from "@/components/attribution";
import { getCurrentUser } from "@/lib/auth";
import { getVisibleGroups } from "@/lib/groups";
import { countHistory, getHistoryRefs } from "@/lib/history";
import { canCompare, isNoAi } from "@/lib/no-ai";
import { buildProfile } from "@/lib/profile";
import { getUserProviderIds } from "@/lib/providers";
import { getGenreNames } from "@/lib/tmdb/genres";
import { getSwedishProviders } from "@/lib/tmdb/providers";
import { signOut } from "../actions";
import { CheckInBell } from "../check-in-bell";
import { AppHeader } from "../find/group-picker";
import home from "../home.module.css";
import { TOP_GENRES, tasteGenres } from "./genres";
import { Chevron, MenuIcon } from "./icons";
import { NoAiSwitch } from "./no-ai-switch";
import styles from "./profile.module.css";

export const metadata: Metadata = { title: "Profil" };

const listSv = new Intl.ListFormat("sv", { type: "conjunction" });
/** Logos on the Tjänster row before "+N". */
const LOGOS = 5;

/**
 * Profil as a menu: Din smak (the conclusion), Historik (the evidence) and
 * Tjänster, each with a line of real data.
 */
export default function ProfilePage() {
  return (
    <main className={home.main}>
      {/* A tab of its own: no way back needed, and no group, since the
          profile is the user's and not the company's. */}
      <AppHeader right={<CheckInBell />}>
        <h1 className="logo">Profil</h1>
      </AppHeader>
      <Suspense fallback={<Menu />}>
        <MenuWithData />
      </Suspense>
      <Suspense>
        <Compare />
      </Suspense>
      <footer className={styles.footer}>
        <form action={signOut}>
          <button className="link">Logga ut</button>
        </form>
        <p className="logo" aria-hidden="true">
          Settle
        </p>
        <Attribution />
      </footer>
    </main>
  );
}

async function MenuWithData() {
  const user = await getCurrentUser();
  const [profile, names, refs, providerIds, providers, groups] =
    await Promise.all([
      buildProfile(user.id),
      getGenreNames(),
      getHistoryRefs(user.id),
      getUserProviderIds(),
      getSwedishProviders(),
      getVisibleGroups(),
    ]);
  const liked = tasteGenres(profile.affinity, names)
    .filter((g) => g.value > 0)
    .slice(0, TOP_GENRES)
    .map((g) => g.name);
  const { seen, disliked } = countHistory(refs);
  const mine = new Set(providerIds);
  const services = providers.filter((p) => mine.has(p.id));

  return (
    <Menu
      taste={
        liked.length
          ? `Gillar mest: ${listSv.format(liked)}`
          : profile.ratingCount
            ? "Betygsätt fler för att se din smak"
            : "Inga betyg än"
      }
      groups={
        groups.length > 1
          ? listSv.format(groups.map((g) => g.name))
          : "Bara du"
      }
      history={
        seen + disliked > 0
          ? [`${seen} sett`, disliked ? `${disliked} ogillade` : null]
              .filter(Boolean)
              .join(" · ")
          : "Inget sett än"
      }
      services={
        services.length ? (
          <span className={styles.logos}>
            {services
              .slice(0, LOGOS)
              .map((p) =>
                p.logoPath ? (
                  <Image
                    key={p.id}
                    src={`https://image.tmdb.org/t/p/w92${p.logoPath}`}
                    alt={p.name}
                    width={24}
                    height={24}
                  />
                ) : (
                  <span key={p.id}>{p.name}</span>
                ),
              )}
            {services.length > LOGOS && <span>+{services.length - LOGOS}</span>}
          </span>
        ) : (
          "Inga tjänster valda"
        )
      }
    />
  );
}

/** The temporary switch for step 5, only for the accounts that compare. */
async function Compare() {
  const user = await getCurrentUser();
  if (!canCompare(user.email)) return null;
  return <NoAiSwitch off={await isNoAi(user.email)} />;
}

/** The rows; without data while it loads, so the page does not jump. */
function Menu({
  taste,
  history,
  groups,
  services,
}: {
  taste?: ReactNode;
  history?: ReactNode;
  groups?: ReactNode;
  services?: ReactNode;
}) {
  return (
    <nav aria-label="Profil">
      <ul className={styles.menu}>
        <Row href="/profile/taste" icon="taste" title="Din smak" sub={taste} />
        <Row
          href="/profile/history"
          icon="history"
          title="Historik"
          sub={history}
        />
        <Row
          href="/profile/groups"
          icon="groups"
          title="Grupper"
          sub={groups}
        />
        <Row
          href="/onboarding/services"
          icon="services"
          title="Tjänster"
          sub={services}
        />
      </ul>
    </nav>
  );
}

function Row({
  href,
  icon,
  title,
  sub,
}: {
  href: string;
  icon: "taste" | "history" | "groups" | "services";
  title: string;
  sub?: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className={styles.row}>
        <span className={styles.rowIcon}>
          <MenuIcon kind={icon} />
        </span>
        <span className={styles.rowText}>
          <strong>{title}</strong>
          <span>{sub ?? " "}</span>
        </span>
        <span className={styles.chevron}>
          <Chevron />
        </span>
      </Link>
    </li>
  );
}
