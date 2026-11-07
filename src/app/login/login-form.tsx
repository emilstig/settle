"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import styles from "./login.module.css";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {
    step: "email",
  });

  if (state.step === "code") {
    return (
      <form action={action} className={styles.form}>
        <p className={styles.lead}>
          Vi har skickat ett mejl till <strong>{state.email}</strong>. Tryck på länken, eller skriv
          in koden här. Koden är bäst om du har lagt appen på hemskärmen.
        </p>
        <label className={styles.label} htmlFor="code">
          Kod från mejlet
        </label>
        <input
          id="code"
          name="code"
          className={styles.input}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={12}
          required
          autoFocus
        />
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        <button className={styles.primary} name="intent" value="verify" disabled={pending}>
          {pending ? "Loggar in …" : "Logga in"}
        </button>
        <button className={styles.secondary} name="intent" value="restart" formNoValidate>
          Använd en annan adress
        </button>
      </form>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <label className={styles.label} htmlFor="email">
        E-post
      </label>
      <input
        id="email"
        name="email"
        type="email"
        className={styles.input}
        autoComplete="email"
        defaultValue={state.email}
        placeholder="namn@exempel.se"
        required
        autoFocus
      />
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      <button className={styles.primary} name="intent" value="send" disabled={pending}>
        {pending ? "Skickar …" : "Skicka inloggningslänk"}
      </button>
      <p className={styles.hint}>Inget lösenord. Du får en länk och en kod på mejlen.</p>
    </form>
  );
}
