/**
 * Promise concurrency pool for parallel uploads.
 */

/**
 * Execute async tasks with a concurrency limit.
 *
 * @param items  Items to process
 * @param concurrency  Max parallel tasks (default 3)
 * @param fn  Async function to run for each item
 */
export async function concurrentPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const pool: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then(() => {
      pool.splice(pool.indexOf(p), 1);
    });
    pool.push(p);

    if (pool.length >= concurrency) {
      await Promise.race(pool);
    }
  }

  await Promise.all(pool);
}
