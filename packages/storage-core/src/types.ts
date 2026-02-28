/**
 * Storage Provider interface for CAS
 *
 * Provides content-addressable storage operations.
 * All keys are 26-character Crockford Base32 encoded BLAKE3s-128 hashes.
 */
export type StorageProvider = {
  /**
   * Get blob content by key
   * Returns null if not found
   */
  get: (key: string) => Promise<Uint8Array | null>;

  /**
   * Store blob content
   * Key must be the correct BLAKE3s-128 hash of the content (CB32 encoded)
   */
  put: (key: string, value: Uint8Array) => Promise<void>;

  /**
   * Delete blob by key (e.g. for CAS GC).
   * Use method name "del" to avoid JS keyword.
   */
  del: (key: string) => Promise<void>;
};
