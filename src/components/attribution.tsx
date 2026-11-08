import styles from "./attribution.module.css";

/** Required credit: TMDB for metadata, JustWatch for streaming availability. */
export function Attribution() {
  return (
    <p className={styles.credit}>
      Titeldata från{" "}
      <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
        TMDB
      </a>
      . Streamingdata från{" "}
      <a href="https://www.justwatch.com/se" target="_blank" rel="noopener noreferrer">
        JustWatch
      </a>
      . Settle använder TMDB:s API men är inte godkänd eller certifierad av TMDB.
    </p>
  );
}
