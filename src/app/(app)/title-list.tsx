import Image from "next/image";
import { discoverForUser } from "@/lib/discover";
import { formatCertSE, formatRuntime, formatVote } from "@/lib/format";
import { getUserProviderIds } from "@/lib/providers";
import { imageUrl } from "@/lib/tmdb/client";
import styles from "./home.module.css";

/** Temporary list for step 2: popular titles on the user's services. */
export async function TitleList() {
  const providerIds = await getUserProviderIds();
  const titles = await discoverForUser({ providerIds });

  if (titles.length === 0) {
    return <p className={styles.meta}>Hittade inget på dina tjänster just nu.</p>;
  }

  return (
    <ul className={styles.list}>
      {titles.map((t) => {
        const poster = imageUrl(t.poster_path, "w185");
        const facts = [
          t.year,
          t.media_type === "movie" ? "Film" : "Serie",
          t.media_type === "movie" ? formatRuntime(t.runtime) : t.runtime ? `${t.runtime} min/avsnitt` : null,
          formatCertSE(t.certification_se),
        ].filter(Boolean);
        const vote = formatVote(t.vote_average);
        return (
          <li key={`${t.media_type}:${t.tmdb_id}`} className={styles.row}>
            {poster ? (
              <Image src={poster} alt="" width={56} height={84} className={styles.poster} />
            ) : (
              <span className={styles.poster} />
            )}
            <span className={styles.rowText}>
              <b>{t.title}</b>
              <small>{facts.join(" · ")}</small>
              <small>
                {t.onServices.map((p) => p.name).join(", ")}
                {vote ? ` · ★ ${vote} på TMDB` : ""}
              </small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
