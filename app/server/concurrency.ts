/** Preserve input order while keeping filesystem work within a fixed budget. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, visit: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await visit(items[index], index);
    }
  }));
  return results;
}
