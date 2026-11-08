"use client";

import Image from "next/image";
import { useActionState } from "react";
import type { Provider } from "@/lib/tmdb/providers";
import { saveServices, type ServicesState } from "./actions";
import styles from "./services.module.css";

const LOGO = (path: string | null) => (path ? `https://image.tmdb.org/t/p/w92${path}` : null);

export function ServicesForm({
  top,
  rest,
  selected,
}: {
  top: Provider[];
  rest: Provider[];
  selected: number[];
}) {
  const [state, action, pending] = useActionState<ServicesState, FormData>(saveServices, {});
  const chosen = new Set(selected);

  return (
    <form action={action} className={styles.form}>
      <fieldset className={styles.fieldset}>
        <legend className="visually-hidden">Dina streamingtjänster</legend>
        <div className={styles.grid}>
          {top.map((p) => (
            <Tile key={p.id} provider={p} checked={chosen.has(p.id)} />
          ))}
        </div>
        {rest.length > 0 && (
          <details className={styles.more}>
            <summary>Visa fler tjänster ({rest.length})</summary>
            <div className={styles.grid}>
              {rest.map((p) => (
                <Tile key={p.id} provider={p} checked={chosen.has(p.id)} />
              ))}
            </div>
          </details>
        )}
      </fieldset>
      <div className={styles.actions}>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        <button className="primary" disabled={pending}>
          {pending ? "Sparar …" : "Spara"}
        </button>
      </div>
    </form>
  );
}

function Tile({ provider, checked }: { provider: Provider; checked: boolean }) {
  const logo = LOGO(provider.logoPath);
  return (
    <label className={styles.tileWrap}>
      <input
        type="checkbox"
        name="provider"
        value={provider.id}
        defaultChecked={checked}
        className="visually-hidden"
      />
      <span className={styles.tile}>
        {logo ? (
          <Image src={logo} alt="" width={44} height={44} className={styles.logo} />
        ) : (
          <span className={styles.logo} />
        )}
        <span className={styles.name}>{provider.name}</span>
      </span>
    </label>
  );
}
