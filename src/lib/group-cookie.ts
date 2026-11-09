/** Cookie with the chosen group's id (see group-choice.ts). */
export const GROUP_COOKIE = "settle_group";

/** Remembers the chosen group in the browser, for the next page and visit. */
export function rememberGroup(id: string) {
  document.cookie = `${GROUP_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}
