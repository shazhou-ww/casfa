import type { KeyProvider } from "@casfa/core";

/**
 * Byte stream type: CAS node body read/write uses streams for streaming passthrough.
 */
export type BytesStream = ReadableStream<Uint8Array>;

/**
 * CAS storage: get returns stream, put accepts stream.
 * Keys are content-addressed (e.g. Crockford Base32 encoded).
 */
export type CasStorage = {
  get: (key: string) => Promise<BytesStream | null>;
  put: (key: string, value: BytesStream) => Promise<void>;
  del: (key: string) => Promise<void>;
};

/**
 * Context for CAS facade: storage and key computation.
 */
export type CasContext = {
  storage: CasStorage;
  key: KeyProvider;
};

/**
 * CAS store info (e.g. for gc and monitoring).
 */
export type CasInfo = {
  /** Last GC run timestamp (ms); null if never run */
  lastGcTime: number | null;
  nodeCount: number;
  totalBytes: number;
};

/**
 * Result of reading a CAS node: key + body stream (no full buffering).
 */
export type CasNodeResult = {
  key: string;
  body: BytesStream;
};

/** CasFacade shape: getNode returns CasNodeResult, putNode accepts BytesStream. */
export type CasFacade = {
  getNode(key: string): Promise<CasNodeResult | null>;
  hasNode(key: string): Promise<boolean>;
  putNode(nodeKey: string, body: BytesStream): Promise<void>;
  gc(nodeKeys: string[], cutOffTime: number): Promise<void>;
  info(): Promise<CasInfo>;
};
