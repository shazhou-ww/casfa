/**
 * Token encryption/decryption using AES-256-GCM
 *
 * Used to encrypt delegate tokens for secure transmission
 */

import type { EncryptedToken } from "./types.ts";

/**
 * AES-256-GCM algorithm parameters
 */
const AES_GCM_ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128; // bits

/**
 * Derive AES-256 key from client secret using HKDF
 *
 * @param secret - 32-byte client secret
 * @param salt - Optional salt (16 bytes recommended)
 * @param info - Optional context info
 * @returns AES-256 CryptoKey
 */
export async function deriveKey(
  secret: Uint8Array,
  salt: Uint8Array = new Uint8Array(16),
  info: string = "casfa-token-encryption"
): Promise<CryptoKey> {
  // Import secret as base key material
  const keyMaterial = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);

  // Derive AES key using HKDF
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode(info),
    },
    keyMaterial,
    { name: AES_GCM_ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt data using AES-256-GCM
 *
 * @param data - Data to encrypt
 * @param key - AES-256 CryptoKey
 * @returns Encrypted token package
 */
export async function encryptAesGcm(data: Uint8Array, key: CryptoKey): Promise<EncryptedToken> {
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    { name: AES_GCM_ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    data
  );

  // The encrypted result includes the auth tag at the end
  const encryptedArray = new Uint8Array(encrypted);
  const tagStart = encryptedArray.length - TAG_LENGTH / 8;
  const ciphertext = encryptedArray.slice(0, tagStart);
  const tag = encryptedArray.slice(tagStart);

  // Encode as Base64
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...ciphertext)),
    tag: btoa(String.fromCharCode(...tag)),
  };
}

/**
 * Decrypt data using AES-256-GCM
 *
 * @param encrypted - Encrypted token package
 * @param key - AES-256 CryptoKey
 * @returns Decrypted data
 * @throws Error if decryption fails (wrong key or tampered data)
 */
export async function decryptAesGcm(
  encrypted: EncryptedToken,
  key: CryptoKey
): Promise<Uint8Array> {
  // Decode from Base64
  const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(encrypted.tag), (c) => c.charCodeAt(0));

  // Combine ciphertext and tag (Web Crypto expects them together)
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_GCM_ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    combined
  );

  return new Uint8Array(decrypted);
}

/**
 * Encrypt a delegate token with a client secret
 *
 * Convenience function that derives the key and encrypts in one step.
 *
 * @param token - Delegate token bytes (32 bytes)
 * @param clientSecret - Client secret bytes (32 bytes)
 * @returns Encrypted token package
 */
export async function encryptToken(
  token: Uint8Array,
  clientSecret: Uint8Array
): Promise<EncryptedToken> {
  const key = await deriveKey(clientSecret);
  return encryptAesGcm(token, key);
}

/**
 * Decrypt a delegate token with a client secret
 *
 * Convenience function that derives the key and decrypts in one step.
 *
 * @param encrypted - Encrypted token package
 * @param clientSecret - Client secret bytes (32 bytes)
 * @returns Decrypted token bytes (32 bytes)
 */
export async function decryptToken(
  encrypted: EncryptedToken,
  clientSecret: Uint8Array
): Promise<Uint8Array> {
  const key = await deriveKey(clientSecret);
  return decryptAesGcm(encrypted, key);
}

/**
 * Format encrypted token as a single string
 *
 * Format: {iv}.{ciphertext}.{tag} (all Base64)
 *
 * @param encrypted - Encrypted token package
 * @returns Formatted string
 */
export function formatEncryptedToken(encrypted: EncryptedToken): string {
  return `${encrypted.iv}.${encrypted.ciphertext}.${encrypted.tag}`;
}

/**
 * Parse encrypted token from formatted string
 *
 * @param str - Formatted string (iv.ciphertext.tag)
 * @returns Encrypted token package
 * @throws Error if format is invalid
 */
export function parseEncryptedToken(str: string): EncryptedToken {
  const parts = str.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid encrypted token format: expected 3 parts, got ${parts.length}`);
  }

  return {
    iv: parts[0]!,
    ciphertext: parts[1]!,
    tag: parts[2]!,
  };
}
