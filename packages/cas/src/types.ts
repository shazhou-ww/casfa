import type { KeyProvider } from "@casfa/core";

/**
 * CAS storage interface: get/put/del for blob storage.
 * Keys are content-addressed (e.g. Crockford Base32 encoded).
 */
export type CasStorage = {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
  del: (key: string) => Promise<void>;
};

/**
 * Context for CAS service: storage and key computation.
 */
export type CasContext = {
  storage: CasStorage;
  key: KeyProvider;
};

/**
 * CAS store info (e.g. for gc and monitoring).
 */
export type CasInfo = {
  /** Last GC run timestamp (ms), if ever run */
  lastGcTime?: number;
  /** Number of nodes (blobs) in the store */
  nodeCount: number;
  /** Total bytes stored */
  totalBytes: number;
};
