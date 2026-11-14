/** Supabase returns at most this many rows per request (max_rows). */
const PAGE = 1000;

/**
 * Reads every row of a query, a page at a time. Without it a query silently
 * stops at 1000 rows, which a week of swipes can pass. The query must have a
 * stable order (for example by id), or the pages can overlap.
 */
export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
