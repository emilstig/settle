"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatRuntime } from "@/lib/format";
import { rememberGroup } from "@/lib/group-cookie";
import type { ListItem } from "@/lib/list";
import {
  addToTonight,
  chooseTonight,
  openDetail,
  removeFromTonight,
  tonight as getTonight,
} from "../find-actions";
import { DetailView } from "../find/detail-view";
import { GroupSheet } from "../find/group-sheet";
import { Toast } from "../find/toast";
import type { ToastButton, ToastState } from "../find/types";
import { useBackClose } from "../find/use-back-close";
import find from "../find/find.module.css";
import {
  listGroupsFor,
  removeFromList,
  setListGroups,
  setListInterest,
} from "./actions";
import styles from "./list.module.css";

type Size = "s" | "m" | "l";
type ShelfKey = "want" | "rewatch" | "maybe" | "elsewhere";
type Shelf = { key: ShelfKey; title: string; size: Size; items: ListItem[] };

/** Cards shown on a shelf before "Visa alla". */
const ON_SHELF = 12;
/** A film this long or shorter counts as "Kort" (series: one episode). */
const SHORT_FILM = 100;
const SHORT_EPISODE = 35;
const BIGGER: Record<Size, Size> = { s: "m", m: "l", l: "l" };

const keyOf = (c: { tmdb_id: number; media_type: string }) =>
  `${c.media_type}:${c.tmdb_id}`;
const refOf = (c: ListItem) => ({
  tmdb_id: c.tmdb_id,
  media_type: c.media_type,
});

/**
 * The shelves, by what the user said and not by genre. A title not on the
 * user's services right now leaves its shelf for the last one. Card size
 * follows the shelf's role, one step bigger when it has only a few titles.
 */
function shelvesOf(items: ListItem[]): Shelf[] {
  const on = items.filter((i) => i.available);
  const shelves: Shelf[] = [
    {
      key: "want",
      title: "Vill gärna",
      size: "l",
      items: on.filter((i) => i.interest === "want"),
    },
    {
      key: "rewatch",
      title: "Att se om",
      size: "m",
      items: on.filter((i) => i.interest === "rewatch"),
    },
    {
      key: "maybe",
      title: "Vill se",
      size: "s",
      items: on.filter((i) => i.interest === "maybe"),
    },
    {
      key: "elsewhere",
      title: "Inte på dina tjänster just nu",
      size: "s",
      items: items.filter((i) => !i.available),
    },
  ];
  return shelves
    .filter((s) => s.items.length > 0)
    .map((s) => (s.items.length <= 3 ? { ...s, size: BIGGER[s.size] } : s));
}

const CHIPS = [
  ["tv", "Serier"],
  ["movie", "Filmer"],
  ["short", "Kort"],
] as const;
type Chip = (typeof CHIPS)[number][0];
const SORTS = [
  ["latest", "Senast"],
  ["rating", "Betyg"],
  ["short", "Kortast"],
] as const;
type Sort = (typeof SORTS)[number][0];

const isShort = (i: ListItem) =>
  i.runtime !== null &&
  i.runtime <= (i.media_type === "movie" ? SHORT_FILM : SHORT_EPISODE);
const vote = (v: number | null) => (v ? v.toFixed(1).replace(".", ",") : null);
const length = (c: ListItem) =>
  c.runtime === null
    ? null
    : c.media_type === "movie"
      ? formatRuntime(c.runtime)
      : `${c.runtime} min/avsnitt`;

export function ListView({
  groups,
  groupId,
  counts,
  items: initialItems,
}: {
  groups: { id: string; name: string; kind: string }[];
  groupId: string;
  /** Titles on each group's list, by group id. */
  counts: Record<string, number>;
  items: ListItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [full, setFull] = useState<ShelfKey | null>(null);
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const [sort, setSort] = useState<Sort>("latest");
  const [detail, setDetail] = useState<{
    item: ListItem;
    trailer: string | null;
    imdbId: string | null;
    loading: boolean;
  } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastId = useRef(0);
  // "Med annan grupp": the title and the groups it is saved for now.
  const [moving, setMoving] = useState<{
    item: ListItem;
    savedFor: string[];
  } | null>(null);
  const group = groups.find((g) => g.id === groupId);
  // What is in Ikväll with the group, so the detail view can say so.
  const [tonightKeys, setTonightKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    getTonight({ groupId })
      .then((t) => {
        if (!alive) return;
        const cards = t.choice ? [t.choice, ...t.saved] : t.saved;
        setTonightKeys(new Set(cards.map(keyOf)));
      })
      .catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, [groupId]);

  useBackClose(full !== null, () => setFull(null));
  useBackClose(detail !== null, () => setDetail(null));
  useBackClose(moving !== null, () => setMoving(null));

  const showToast = (text: string, buttons: ToastButton[] = [], ms = 2200) => {
    setToast({ id: ++toastId.current, text, buttons, ms });
  };

  const pickGroup = (id: string) => {
    if (id === groupId) return;
    rememberGroup(id);
    router.refresh();
  };

  function open(item: ListItem) {
    setDetail({ item, trailer: null, imdbId: null, loading: true });
    openDetail({ sessionId: null, ref: refOf(item), source: null })
      .then((r) =>
        setDetail((d) =>
          d && d.item === item
            ? { ...d, trailer: r.trailerKey, imdbId: r.imdbId, loading: false }
            : d,
        ),
      )
      .catch(() =>
        setDetail((d) => (d && d.item === item ? { ...d, loading: false } : d)),
      );
  }

  async function remove(item: ListItem) {
    const before = items;
    setItems((list) => list.filter((i) => keyOf(i) !== keyOf(item)));
    setDetail(null);
    try {
      const removed = await removeFromList({ groupId, ref: refOf(item) });
      if (!removed) return;
      showToast(
        "Borttagen från listan",
        [
          {
            label: "Ångra",
            onClick: () => {
              setItems(before);
              setListInterest({
                groupId,
                ref: refOf(item),
                interest: removed.interest,
                addedAt: removed.addedAt,
              }).catch((e) => {
                console.error(e);
                router.refresh();
              });
            },
          },
        ],
        4000,
      );
    } catch (e) {
      console.error(e);
      setItems(before);
      showToast("Det gick inte att ta bort");
    }
  }

  async function toggleWant(item: ListItem) {
    // "Vill gärna" off goes back to "Vill se". Se igen titles do not get
    // the button: wanting to see it again is its own choice.
    const next = item.interest === "want" ? "maybe" : "want";
    const updated = { ...item, interest: next } as ListItem;
    setItems((list) =>
      list.map((i) => (keyOf(i) === keyOf(item) ? updated : i)),
    );
    setDetail((d) => (d ? { ...d, item: updated } : d));
    try {
      await setListInterest({ groupId, ref: refOf(item), interest: next });
    } catch (e) {
      console.error(e);
      setItems((list) =>
        list.map((i) => (keyOf(i) === keyOf(item) ? item : i)),
      );
      showToast("Det gick inte att spara");
    }
  }

  async function toggleTonight(item: ListItem) {
    const k = keyOf(item);
    const was = tonightKeys.has(k);
    const flip = (on: boolean) =>
      setTonightKeys((keys) => {
        const next = new Set(keys);
        if (on) next.add(k);
        else next.delete(k);
        return next;
      });
    flip(!was);
    try {
      if (was) {
        await removeFromTonight({ groupId, ref: refOf(item) });
        showToast("Borttagen från ikväll");
      } else {
        await addToTonight({ groupId, ref: refOf(item) });
        showToast(
          "Tillagd i ikväll",
          [{ label: "Visa", onClick: () => router.push("/") }],
          4000,
        );
      }
    } catch (e) {
      console.error(e);
      flip(was);
      showToast("Det gick inte att spara");
    }
  }

  function openGroups(item: ListItem) {
    listGroupsFor({ ref: refOf(item) })
      .then((savedFor) => setMoving({ item, savedFor }))
      .catch((e) => {
        console.error(e);
        showToast("Det gick inte att hämta grupperna");
      });
  }

  async function finishGroups(groupIds: string[] | null) {
    if (!moving) return;
    const { item } = moving;
    setMoving(null);
    if (!groupIds) return;
    try {
      await setListGroups({ ref: refOf(item), groupIds });
      // Off this group's list: it leaves the shelves here too.
      if (!groupIds.includes(groupId)) {
        setItems((list) => list.filter((i) => keyOf(i) !== keyOf(item)));
        setDetail(null);
      }
      const names = groups
        .filter((g) => groupIds.includes(g.id))
        .map((g) => g.name);
      showToast(`Sparad för ${names.join(" och ")}`);
      router.refresh();
    } catch (e) {
      console.error(e);
      showToast("Det gick inte att spara");
    }
  }

  async function choose(item: ListItem) {
    try {
      await chooseTonight({ groupId, ref: refOf(item) });
      setDetail(null);
      showToast(
        `Ikväll blir det ${item.title}`,
        [{ label: "Visa", onClick: () => router.push("/") }],
        4000,
      );
    } catch (e) {
      console.error(e);
      showToast("Det gick inte att spara valet");
    }
  }

  const shelves = shelvesOf(items);
  const fullShelf = shelves.find((s) => s.key === full) ?? null;
  const fullItems = fullShelf
    ? [...fullShelf.items]
        .filter(
          (i) =>
            (!chips.has("tv") || i.media_type === "tv") &&
            (!chips.has("movie") || i.media_type === "movie") &&
            (!chips.has("short") || isShort(i)),
        )
        .sort((a, b) =>
          sort === "rating"
            ? (b.vote_average ?? 0) - (a.vote_average ?? 0)
            : sort === "short"
              ? (a.runtime ?? Infinity) - (b.runtime ?? Infinity)
              : b.addedAt.localeCompare(a.addedAt),
        )
    : [];
  const together = group?.kind !== "solo";

  return (
    <>
      <h1 className="q">{together ? "Vad ska ni se?" : "Vad ska du se?"}</h1>
      <div className={find.who} role="radiogroup" aria-label="Vem tittar">
        {groups.map((g) => {
          const on = g.id === groupId;
          const n = counts[g.id] ?? 0;
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={find.tile}
              onClick={() => pickGroup(g.id)}
            >
              <span className={find.tileName}>{g.name}</span>
              <span className={find.tileSub}>
                {n === 0 ? "Inget sparat" : `${n} sparade`}
              </span>
            </button>
          );
        })}
      </div>

      {shelves.length === 0 && (
        <p className={styles.empty}>
          Inget sparat för {group?.name} än. Svep höger på något i Hitta, så
          hamnar det här.
        </p>
      )}

      {shelves.map((s) => (
        <section key={s.key} className={styles.shelf} aria-label={s.title}>
          <div className={styles.shelfHead}>
            <h2>{s.title}</h2>
            <button
              type="button"
              className="link"
              onClick={() => {
                setChips(new Set());
                setSort("latest");
                setFull(s.key);
              }}
            >
              Visa alla {s.items.length > ON_SHELF ? `(${s.items.length})` : ""}
            </button>
          </div>
          <ul className={styles.row}>
            {s.items.slice(0, ON_SHELF).map((i) => (
              <li key={keyOf(i)}>
                <button
                  type="button"
                  className={`${styles.poster} ${styles[s.size]}`}
                  aria-label={i.title}
                  onClick={() => open(i)}
                >
                  {i.poster_path ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w342${i.poster_path}`}
                      alt=""
                      fill
                      sizes={
                        s.size === "l"
                          ? "180px"
                          : s.size === "m"
                            ? "140px"
                            : "104px"
                      }
                    />
                  ) : (
                    <span className={styles.noPoster}>{i.title}</span>
                  )}
                </button>
                {!i.available && (
                  <span className={styles.elsewhere}>
                    {i.elsewhere.length
                      ? `Finns på ${i.elsewhere[0]}`
                      : "Inte på någon tjänst"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {fullShelf && (
        <div
          className={styles.full}
          role="dialog"
          aria-modal="true"
          aria-labelledby="full-title"
        >
          <div className={styles.fullWrap}>
            <button
              type="button"
              className={find.dback}
              onClick={() => setFull(null)}
            >
              ‹ Tillbaka
            </button>
            <h2 id="full-title" className="q">
              {fullShelf.title}
            </h2>
            <div className="chips" role="group" aria-label="Visa">
              {CHIPS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  aria-pressed={chips.has(value)}
                  onClick={() =>
                    setChips((c) => {
                      const n = new Set(c);
                      if (n.has(value)) n.delete(value);
                      else {
                        n.add(value);
                        // Serier and Filmer exclude each other.
                        if (value === "tv") n.delete("movie");
                        if (value === "movie") n.delete("tv");
                      }
                      return n;
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="chips" role="group" aria-label="Sortera">
              {SORTS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  aria-pressed={sort === value}
                  onClick={() => setSort(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {fullItems.length === 0 && (
              <p className={styles.empty}>Inget som passar de valen.</p>
            )}
            <ul className={`${find.tonightList} ${styles.fullList}`}>
              {fullItems.map((i) => {
                const info = [
                  i.media_type === "movie" ? "Film" : "Serie",
                  length(i),
                  vote(i.vote_average) ? `★ ${vote(i.vote_average)}` : null,
                  !i.available && i.elsewhere.length
                    ? `Finns på ${i.elsewhere[0]}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={keyOf(i)} className={find.tonightRow}>
                    <button
                      type="button"
                      className={find.tonightOpen}
                      aria-label={`Visa ${i.title}`}
                      onClick={() => open(i)}
                    >
                      <span className={find.tonightThumb}>
                        {i.poster_path && (
                          <Image
                            src={`https://image.tmdb.org/t/p/w92${i.poster_path}`}
                            alt=""
                            fill
                            sizes="44px"
                          />
                        )}
                      </span>
                      <span className={find.tonightText}>
                        <strong>{i.title}</strong>
                        <span>{info}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {detail && (
        <DetailView
          card={detail.item}
          trailerKey={detail.trailer}
          imdbId={detail.imdbId}
          trailerLoading={detail.loading}
          actions="list"
          onClose={() => setDetail(null)}
          onDecide={() => {}}
          onChoose={() => void choose(detail.item)}
          list={{
            wanted: detail.item.interest === "want",
            onRemove: () => void remove(detail.item),
            onWant:
              detail.item.interest === "rewatch"
                ? undefined
                : () => void toggleWant(detail.item),
            tonight: tonightKeys.has(keyOf(detail.item)),
            onTonight: () => void toggleTonight(detail.item),
          }}
          groupsRow={{
            label: "Med annan grupp",
            hint: "Välj vilka gruppers listor den ligger på",
            onClick: () => openGroups(detail.item),
          }}
        />
      )}

      {moving && (
        <GroupSheet
          title={moving.item.title}
          groups={groups}
          savedFor={moving.savedFor}
          onDone={(ids) => void finishGroups(ids)}
        />
      )}

      <Toast key={toast?.id} toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
