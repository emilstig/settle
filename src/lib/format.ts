/** "1 tim 43 min", "45 min". */
export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} tim` : `${h} tim ${m} min`;
}

/** TMDB rating with Swedish decimal comma: "7,6". */
export const formatVote = (vote: number | null | undefined) =>
  vote ? vote.toFixed(1).replace(".", ",") : null;

/** Swedish age rating for display: "Barntillåten", "Från 11 år". */
export function formatCertSE(cert: string | null | undefined): string | null {
  if (!cert) return null;
  if (/btl|barntill/i.test(cert)) return "Barntillåten";
  const age = cert.match(/\d{1,2}/)?.[0];
  return age ? `Från ${age} år` : null;
}
