/**
 * Storage Provider interface for CAS
 *
 * Provides content-addressable storage operations.
 * All keys are 26-character Crockford Base32 encoded BLAKE3s-128 hashes.
 */
export type StorageProvider = {
  /**
   * Check if a key exists in storage
   */
  has: (key: string) => Promise<boolean>;

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
};
