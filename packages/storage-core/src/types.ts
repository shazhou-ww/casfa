/**
 * Storage Provider interface for CAS
 *
 * Provides content-addressable storage operations.
 * All keys are in format "sha256:{64-char-hex}"
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
   * Key must be the correct SHA-256 hash of the content
   */
  put: (key: string, value: Uint8Array) => Promise<void>;
};

/**
 * Hash Provider interface
 *
 * Provides cryptographic hash operations.
 */
export type HashProvider = {
  /**
   * Compute SHA-256 hash of data
   */
  sha256: (data: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Storage Provider configuration
 */
export type StorageConfig = {
  /**
   * Key prefix in storage
   * Default: "cas/sha256/"
   */
  prefix?: string;

  /**
   * LRU cache size for key existence checks
   * Default: 10000
   */
  cacheSize?: number;
};
