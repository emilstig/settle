"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CheckIn } from "@/lib/check-in";
import { answerCheckIn, checkIns } from "./check-in-actions";
import { useBackClose } from "./find/use-back-close";
import find from "./find/find.module.css";
import styles from "./check-in.module.css";

// One list for every header (Hitta, Att se, Profil), so an answer in one tab
// is gone from the badge in the others too.
let items: CheckIn[] | null = null;
let loading = false;
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((s) => s());
function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
function load() {
  if (loading) return;
  loading = true;
  checkIns()
    .then((r) => {
      items = r;
      emit();
    })
    .catch((e) => console.error(e))
    .finally(() => {
      loading = false;
    });
}
function setItems(next: CheckIn[]) {
  items = next;
  emit();
}

const RATINGS = [
  ["Ogillade", -1],
  ["Gillar", 1],
  ["Gillar mycket", 2],
  ["Älskar", 3],
] as const;
type Rating = (typeof RATINGS)[number][1];
type Answer = Parameters<typeof answerCheckIn>[0]["answer"];

/**
 * Efter tittning: the clock in the header, with the number of earlier
 * evenings' choices to answer. A tap opens a sheet that asks one at a time:
 * how a film was, or whether the user goes on with a series.
 */
export function CheckInBell() {
  const router = useRouter();
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => null,
  );
  const [open, setOpen] = useState(false);
  // A series that is finished asks how it was, as a second step.
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (items === null) load();
    // A new day can bring a new question: ask again when the app is back.
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  const close = () => {
    setOpen(false);
    setFinishing(false);
    setError(null);
  };
  useBackClose(open, close);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const count = list?.length ?? 0;
  const current = list?.[0] ?? null;
  useEffect(() => {
    if (open)
      (
        rowRef.current?.querySelector("button") as HTMLButtonElement | null
      )?.focus();
  }, [open, current, finishing]);

  function answer(c: CheckIn, a: Answer) {
    const before = items ?? [];
    setItems(before.filter((i) => i !== c));
    setFinishing(false);
    setError(null);
    answerCheckIn({
      sessionIds: c.sessionIds,
      ref: { tmdb_id: c.tmdb_id, media_type: c.media_type },
      answer: a,
    })
      // Historik, Att se and the deck show what was said.
      .then(() => router.refresh())
      .catch((e) => {
        console.error(e);
        setItems(before);
        setError("Det gick inte att spara. Prova igen.");
      });
  }

  const rate = (c: CheckIn, r: Rating) =>
    answer(
      c,
      c.media_type === "movie"
        ? { kind: "rating", rating: r }
        : { kind: "status", status: "finished", rating: r },
    );

  return (
    <>
      <button
        type="button"
        className={styles.bell}
        aria-label={
          count ? `Efter tittning, ${count} att svara på` : "Efter tittning"
        }
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {/* Out of the header, which is a stacking context of its own. */}
      {open &&
        createPortal(
          <>
            <div className={find.scrim} onClick={close} />
            <div
              className={`${find.sheet} ${find.sheetOpen}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="checkin-title"
            >
              <div className={find.sheetHead}>
                <small className={styles.label}>
                  Efter tittning
                  {count > 1 ? ` · ${count} att svara på` : ""}
                </small>
                <button
                  type="button"
                  className={find.sheetClose}
                  aria-label="Stäng"
                  onClick={close}
                >
                  ✕
                </button>
              </div>

              {!current ? (
                <>
                  <h3 id="checkin-title">
                    {list === null ? "Hämtar …" : "Inget att svara på just nu"}
                  </h3>
                  {list !== null && (
                    <p>
                      När du har valt något för en kväll frågar vi här dagen
                      efter hur det var.
                    </p>
                  )}
                </>
              ) : (
                <div className={styles.ask}>
                  <span className={styles.thumb}>
                    {current.poster_path && (
                      <Image
                        src={`https://image.tmdb.org/t/p/w154${current.poster_path}`}
                        alt=""
                        fill
                        sizes="64px"
                      />
                    )}
                  </span>
                  <div className={styles.askText}>
                    {current.media_type === "movie" ? (
                      <>
                        <h3 id="checkin-title">
                          Såg du {current.title} {current.when}?
                        </h3>
                        <p>Hur var den?</p>
                      </>
                    ) : finishing ? (
                      <>
                        <h3 id="checkin-title">Hur var {current.title}?</h3>
                        <p>Den hamnar i din historik.</p>
                      </>
                    ) : (
                      <>
                        <h3 id="checkin-title">
                          Fortsätter du med {current.title}?
                        </h3>
                        <p>Du valde den {current.when}.</p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {current && (
                <>
                  <div className={find.sheetRow} ref={rowRef}>
                    {current.media_type === "tv" && !finishing ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            answer(current, {
                              kind: "status",
                              status: "watching",
                              rating: null,
                            })
                          }
                        >
                          Ja
                        </button>
                        <button
                          type="button"
                          onClick={() => setFinishing(true)}
                        >
                          Klar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            answer(current, {
                              kind: "status",
                              status: "dropped",
                              rating: null,
                            })
                          }
                        >
                          Slutade
                        </button>
                      </>
                    ) : (
                      RATINGS.map(([label, value]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => rate(current, value)}
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    className={find.sheetSkip}
                    onClick={() =>
                      finishing
                        ? answer(current, {
                            kind: "status",
                            status: "finished",
                            rating: null,
                          })
                        : answer(current, { kind: "notSeen" })
                    }
                  >
                    {finishing ? "Hoppa över steget" : "Såg den inte"}
                  </button>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
