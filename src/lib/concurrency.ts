/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input order.
 *
 * Several call sites previously used `Promise.all` over an unbounded list against
 * NLM's RxNav, which asks clients to stay under 20 requests a second — a patient with
 * a dozen medications could exceed that from a single request.
 */
export async function limitConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: width }, run));
  return results;
}
