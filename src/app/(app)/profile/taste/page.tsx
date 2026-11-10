import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { buildProfile } from "@/lib/profile";
import { getGenreNames } from "@/lib/tmdb/genres";
import home from "../../home.module.css";
import { TOP_GENRES, tasteGenres } from "../genres";
import { GenreIcon } from "../icons";
import { SubHeader } from "../sub-header";
import styles from "../profile.module.css";

export const metadata: Metadata = { title: "Din smak" };

/**
 * Din smak: the conclusion the app has drawn, as genre tiles. The evidence
 * is in Historik, linked from "Bygger på N betyg".
 */
export default function TastePage() {
  return (
    <main className={home.main}>
      <SubHeader title="Din smak" />
      <Suspense fallback={<p className={home.wait}>Läser din smak …</p>}>
        <Taste />
      </Suspense>
    </main>
  );
}

async function Taste() {
  const user = await getCurrentUser();
  const [profile, names] = await Promise.all([
    buildProfile(user.id),
    getGenreNames(),
  ]);
  const genres = tasteGenres(profile.affinity, names);
  const max = Math.max(0, ...genres.map((g) => Math.abs(g.value)));
  const n = profile.ratingCount;

  return (
    <div className={styles.taste}>
      <p className={styles.lead}>
        <Link href="/profile/history">Bygger på {n} betyg</Link>, från
        kalibreringen och när du tittar själv.
        {profile.groupRatingCount > 0 &&
          ` ${profile.groupRatingCount} betyg med andra grupper räknas som gruppernas egen smak.`}
      </p>

      {genres.length > 0 ? (
        <ul className={styles.tiles}>
          {genres.map((g, i) => {
            const top = g.value > 0 && i < TOP_GENRES;
            const low = g.value < 0;
            return (
              <li
                key={g.id}
                className={`${styles.tile} ${top ? styles.top : ""} ${
                  low ? styles.low : ""
                }`}
              >
                <div className={styles.tileHead}>
                  <GenreIcon id={g.id} />
                  <strong>{g.name}</strong>
                </div>
                <div className={styles.bar} aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.max(6, (Math.abs(g.value) / max) * 100)}%`,
                    }}
                  />
                </div>
                <span className={styles.tag}>
                  {top ? "Gillar mest" : low ? "Mindre för dig" : "Gillar"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.lead}>
          Din smak syns här när du har betygsatt några titlar i varje genre.
        </p>
      )}

      <div className={styles.actions}>
        <Link href="/calibrate" className="primary">
          Fortsätt kalibrera
        </Link>
      </div>

      <details className={styles.asText}>
        <summary>Visa som text</summary>
        <pre className={styles.profile}>{profile.text}</pre>
      </details>
    </div>
  );
}
