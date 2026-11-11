"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setGroupOn } from "@/lib/group-settings";
import { setYoungestAge } from "../../actions";
import { DEFAULT_AGE } from "../../find/group-picker";
import find from "../../find/find.module.css";
import styles from "../profile.module.css";

const AGES = Array.from({ length: 18 }, (_, i) => i);

type Row = {
  id: string;
  name: string;
  family: boolean;
  age: number | null;
  on: boolean;
};

/** A switch per group, and for Familj the youngest's age. */
export function GroupSwitches({ groups: initial }: { groups: Row[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initial);
  const [editingAge, setEditingAge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<Row>) =>
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  function toggle(g: Row, on: boolean) {
    update(g.id, { on });
    setError(null);
    setGroupOn({ groupId: g.id, on })
      .then(() => router.refresh())
      .catch((e) => {
        console.error(e);
        update(g.id, { on: !on });
        setError("Det gick inte att spara. Prova igen.");
      });
  }

  function pickAge(g: Row, age: number) {
    const before = g.age;
    update(g.id, { age });
    setEditingAge(false);
    setError(null);
    setYoungestAge({ groupId: g.id, age }).catch((e) => {
      console.error(e);
      update(g.id, { age: before });
      setError("Det gick inte att spara åldern. Prova igen.");
    });
  }

  return (
    <>
      <ul className={styles.menu}>
        {groups.map((g) => (
          <li key={g.id}>
            <label className={styles.switchRow}>
              <span className={styles.rowText}>
                <strong>{g.name}</strong>
                {g.family && g.on && (
                  <span>Från {g.age ?? DEFAULT_AGE} år</span>
                )}
              </span>
              <input
                type="checkbox"
                role="switch"
                className={styles.switch}
                checked={g.on}
                onChange={(e) => toggle(g, e.target.checked)}
              />
            </label>
            {g.family && g.on && (
              <div className={styles.ageRow}>
                {editingAge ? (
                  <div className={find.age} role="group" aria-labelledby="age-q">
                    <p id="age-q" className={find.ageQ}>
                      Hur gammal är den yngsta?
                    </p>
                    <div className={find.ages}>
                      {AGES.map((age) => (
                        <button
                          key={age}
                          type="button"
                          className="chip"
                          aria-pressed={age === (g.age ?? DEFAULT_AGE)}
                          onClick={() => pickAge(g, age)}
                        >
                          {age}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditingAge(true)}
                  >
                    Ändra åldern
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
