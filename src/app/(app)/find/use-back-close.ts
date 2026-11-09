"use client";

import { useEffect, useRef } from "react";

/**
 * Layers on top of Hitta (the Ikväll sheet, the detail view) each push a
 * history entry while open, so the phone's back gesture closes the top layer
 * instead of leaving the page. Only the top layer reacts to back. When a
 * layer is closed in the app (its cross, "Tillbaka"), its entry is taken
 * off again, and that popstate is ignored so the layer below stays open.
 */
const stack: number[] = [];
const closers = new Map<number, () => void>();
let nextId = 0;
let ignore = 0;
let listening = false;

function onPopState() {
  if (ignore > 0) {
    ignore--;
    return;
  }
  const top = stack.pop();
  if (top === undefined) return;
  const close = closers.get(top);
  closers.delete(top);
  close?.();
}

export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const id = ++nextId;
    window.history.pushState(window.history.state, "");
    stack.push(id);
    closers.set(id, () => closeRef.current());
    return () => {
      const at = stack.indexOf(id);
      // Already gone: closed by the back gesture.
      if (at === -1) return;
      stack.splice(at, 1);
      closers.delete(id);
      ignore++;
      window.history.back();
    };
  }, [open]);
}
