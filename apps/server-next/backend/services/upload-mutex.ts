/**
 * Per-key mutex: only one async block runs at a time per key.
 * Used to serialize file uploads per realm so concurrent uploads don't overwrite each other's root.
 */
const pending = new Map<string, Promise<unknown>>();

export async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = pending.get(key);
  const promise = (async () => {
    await prior;
    return fn();
  })();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    if (pending.get(key) === promise) {
      pending.delete(key);
    }
  }
}
