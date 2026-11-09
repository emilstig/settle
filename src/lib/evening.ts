const TIME_ZONE = "Europe/Stockholm";
/** An evening runs from 05:00 to 05:00, so after midnight is still tonight. */
const EVENING_STARTS_AT = 5;

/** Wall-clock time in Stockholm, as a UTC timestamp with the same fields. */
function stockholmWall(d: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
}

/** When tonight started, as an ISO timestamp. */
export function eveningStart(now = new Date()): string {
  const wall = stockholmWall(now);
  const offset = wall - now.getTime();
  const w = new Date(wall);
  let start = Date.UTC(
    w.getUTCFullYear(),
    w.getUTCMonth(),
    w.getUTCDate(),
    EVENING_STARTS_AT,
  );
  if (w.getUTCHours() < EVENING_STARTS_AT) start -= 24 * 3600 * 1000;
  return new Date(start - offset).toISOString();
}
