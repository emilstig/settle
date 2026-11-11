"use client";

/**
 * Each tab keeps its own place, as in a native tab bar: the page the user
 * was on in the tab (Historik under Profil, say) and how far down each page
 * was scrolled. Lives in memory for the visit; a reload starts over.
 */

export type TabRoot = "/" | "/list" | "/profile";

export function tabOf(path: string): TabRoot {
  if (path.startsWith("/list")) return "/list";
  if (path.startsWith("/profile")) return "/profile";
  return "/";
}

/** The pages visited in each tab, root first, the current one last. */
const stacks: Record<TabRoot, string[]> = {
  "/": ["/"],
  "/list": ["/list"],
  "/profile": ["/profile"],
};
/** Scroll position per page, saved while the page is shown. */
const scrolls = new Map<string, number>();
let current: string | null = null;
let previous: string | null = null;
let pending: { path: string; y: number } | null = null;

/** Called once per committed page. */
export function visit(path: string) {
  if (path === current) return;
  previous = current;
  current = path;
  // Calibration is a task of its own, not a page in Hitta.
  if (path.startsWith("/calibrate")) return;
  const stack = stacks[tabOf(path)];
  const at = stack.indexOf(path);
  if (at >= 0) stack.length = at + 1;
  else stack.push(path);
}

/** Saves the scroll for the page on screen; ignores a page not yet committed. */
export function saveScroll() {
  if (current && window.location.pathname === current)
    scrolls.set(current, window.scrollY);
}

/** Where a tab opens: the page last seen in it. */
export function lastIn(tab: TabRoot) {
  const stack = stacks[tab];
  return stack[stack.length - 1];
}

/** The page under the current one in its tab, for the header's back arrow. */
export function parentOf(path: string) {
  const stack = stacks[tabOf(path)];
  const at = stack.indexOf(path);
  return at > 0 ? stack[at - 1] : null;
}

/** True when the page before this one in history is `path`. */
export function cameFrom(path: string) {
  return previous === path;
}

/** Asks for `path` to open at its saved scroll once it is shown. */
export function restoreOnArrival(path: string) {
  pending = { path, y: scrolls.get(path) ?? 0 };
}

/**
 * Scrolls a newly shown page back to its saved position. The content may
 * still be loading, so it keeps trying for a moment until the page is tall
 * enough, and gives up as soon as the user touches or scrolls.
 */
export function restoreIfPending(path: string) {
  if (!pending || pending.path !== path) return;
  const { y } = pending;
  pending = null;
  const until = performance.now() + 1500;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const opts = { once: true, passive: true } as const;
  window.addEventListener("touchstart", stop, opts);
  window.addEventListener("wheel", stop, opts);
  const step = () => {
    if (stopped || window.location.pathname !== path) return;
    window.scrollTo(0, y);
    const done = Math.abs(window.scrollY - y) < 2;
    if (!done && performance.now() < until) requestAnimationFrame(step);
    else {
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("wheel", stop);
    }
  };
  step();
}
