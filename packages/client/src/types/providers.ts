/**
 * Storage Provider for caching CAS blocks locally.
 * Compatible with @anthropic-ai/cas-storage-* packages.
 */
export type StorageProvider = {
  /** Check if a block exists in storage */
  has: (key: string) => Promise<boolean>;
  /** Get a block from storage, returns null if not found */
  get: (key: string) => Promise<Uint8Array | null>;
  /** Store a block in storage */
  put: (key: string, value: Uint8Array) => Promise<void>;
};

/**
 * Hash Provider for computing content hashes.
 */
export type HashProvider = {
  /** Compute SHA-256 hash of data */
  sha256: (data: Uint8Array) => Promise<Uint8Array>;
  /** Compute BLAKE3 hash of data (optional) */
  blake3?: (data: Uint8Array) => Promise<Uint8Array>;
};

/**
 * P256 Key Pair for AWP client authentication.
 */
export type P256KeyPair = {
  /** Public key in uncompressed format (65 bytes) or compressed (33 bytes) */
  publicKey: Uint8Array;
  /** Private key (32 bytes) */
  privateKey: Uint8Array;
};

/**
 * Key Pair Provider for managing P256 client credentials.
 * Users can implement this to persist keys in localStorage, keychain, file, etc.
 */
export type KeyPairProvider = {
  /** Load existing key pair, returns null if not found */
  load: () => Promise<P256KeyPair | null>;
  /** Save key pair to persistent storage */
  save: (keyPair: P256KeyPair) => Promise<void>;
  /** Generate a new P256 key pair */
  generate: () => Promise<P256KeyPair>;
  /** Sign data with the private key, returns DER-encoded signature */
  sign: (data: Uint8Array, privateKey: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Default hash provider using Web Crypto API.
 * Works in both browser and Node.js environments.
 */
export const createWebCryptoHashProvider = (): HashProvider => ({
  sha256: async (data: Uint8Array): Promise<Uint8Array> => {
    // Create a copy to ensure we have a plain ArrayBuffer
    const buffer = new Uint8Array(data).buffer as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return new Uint8Array(hashBuffer);
  },
});
