"use client";

import { useEffect } from "react";
import type { ToastState } from "./types";
import styles from "./find.module.css";

export function Toast({
  toast,
  onClose,
}: {
  toast: ToastState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      toast.onTimeout?.();
      onClose();
    }, toast.ms);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={styles.toast} role="status">
      <span>{toast.text}</span>
      {toast.buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={() => {
            onClose();
            b.onClick();
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
