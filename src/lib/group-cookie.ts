/** Cookie with the chosen group's id (see group-choice.ts). */
export const GROUP_COOKIE = "settle_group";

/** Remembers the chosen group in the browser, for the next page and visit. */
export function rememberGroup(id: string) {
  document.cookie = `${GROUP_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The chosen group as the browser has it now. The page's own value can be
 * an older render, kept by the router, after a change in another tab.
 */
export function readGroup(): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${GROUP_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(GROUP_COOKIE.length + 1)) : null;
}
