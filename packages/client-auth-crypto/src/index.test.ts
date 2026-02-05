/**
 * Client auth crypto tests
 */

import { describe, it, expect } from "bun:test";
import {
  // PKCE
  generateCodeVerifier,
  generateCodeChallenge,
  generatePkceChallenge,
  verifyPkceChallenge,
  // Client Secret
  generateClientSecret,
  parseClientSecret,
  generateDisplayCode,
  verifyDisplayCode,
  // Encryption
  deriveKey,
  encryptAesGcm,
  decryptAesGcm,
  encryptToken,
  decryptToken,
  formatEncryptedToken,
  parseEncryptedToken,
} from "./index.ts";

// ============================================================================
// PKCE Tests
// ============================================================================

describe("generateCodeVerifier", () => {
  it("should generate verifier of default length (64)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBe(64);
  });

  it("should generate verifier of custom length", () => {
    const verifier = generateCodeVerifier(128);
    expect(verifier.length).toBe(128);
  });

  it("should use URL-safe characters only", () => {
    const verifier = generateCodeVerifier();
    // URL-safe Base64: A-Z, a-z, 0-9, -, _
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should throw on length < 43", () => {
    expect(() => generateCodeVerifier(42)).toThrow();
  });

  it("should throw on length > 128", () => {
    expect(() => generateCodeVerifier(129)).toThrow();
  });

  it("should generate unique verifiers", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });
});

describe("generateCodeChallenge", () => {
  it("should generate 43-character challenge (Base64 of SHA-256)", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge.length).toBe(43);
  });

  it("should use URL-safe characters", async () => {
    const challenge = await generateCodeChallenge("test-verifier-12345678901234567890123456");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should produce consistent results", async () => {
    const verifier = "consistent-verifier-12345678901234567890123";
    const c1 = await generateCodeChallenge(verifier);
    const c2 = await generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });
});

describe("generatePkceChallenge", () => {
  it("should return verifier, challenge, and method", async () => {
    const pkce = await generatePkceChallenge();
    expect(pkce.verifier).toBeDefined();
    expect(pkce.challenge).toBeDefined();
    expect(pkce.method).toBe("S256");
  });

  it("should verify correctly", async () => {
    const pkce = await generatePkceChallenge();
    const isValid = await verifyPkceChallenge(pkce.verifier, pkce.challenge);
    expect(isValid).toBe(true);
  });
});

describe("verifyPkceChallenge", () => {
  it("should return true for valid pair", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(await verifyPkceChallenge(verifier, challenge)).toBe(true);
  });

  it("should return false for wrong verifier", async () => {
    const challenge = await generateCodeChallenge(generateCodeVerifier());
    const wrongVerifier = generateCodeVerifier();
    expect(await verifyPkceChallenge(wrongVerifier, challenge)).toBe(false);
  });
});

// ============================================================================
// Client Secret Tests
// ============================================================================

describe("generateClientSecret", () => {
  it("should generate 32-byte secret", () => {
    const secret = generateClientSecret();
    expect(secret.bytes.length).toBe(32);
  });

  it("should generate 52-character encoded secret", () => {
    const secret = generateClientSecret();
    expect(secret.encoded.length).toBe(52);
  });

  it("should generate unique secrets", () => {
    const s1 = generateClientSecret();
    const s2 = generateClientSecret();
    expect(s1.encoded).not.toBe(s2.encoded);
  });
});

describe("parseClientSecret", () => {
  it("should parse valid encoded secret", () => {
    const original = generateClientSecret();
    const parsed = parseClientSecret(original.encoded);
    expect(parsed.bytes).toEqual(original.bytes);
  });

  it("should throw on wrong length", () => {
    expect(() => parseClientSecret("SHORT")).toThrow(/Invalid client secret length/);
  });
});

describe("generateDisplayCode", () => {
  it("should generate 6-digit code", async () => {
    const secret = generateClientSecret();
    const display = await generateDisplayCode(secret);
    expect(display.code.length).toBe(6);
    expect(display.code).toMatch(/^\d{6}$/);
  });

  it("should format with dash", async () => {
    const secret = generateClientSecret();
    const display = await generateDisplayCode(secret);
    expect(display.formatted).toMatch(/^\d{3}-\d{3}$/);
  });

  it("should be deterministic", async () => {
    const secret = generateClientSecret();
    const d1 = await generateDisplayCode(secret);
    const d2 = await generateDisplayCode(secret);
    expect(d1.code).toBe(d2.code);
  });
});

describe("verifyDisplayCode", () => {
  it("should verify raw code", async () => {
    const secret = generateClientSecret();
    const display = await generateDisplayCode(secret);
    expect(await verifyDisplayCode(secret, display.code)).toBe(true);
  });

  it("should verify formatted code", async () => {
    const secret = generateClientSecret();
    const display = await generateDisplayCode(secret);
    expect(await verifyDisplayCode(secret, display.formatted)).toBe(true);
  });

  it("should reject wrong code", async () => {
    const secret = generateClientSecret();
    expect(await verifyDisplayCode(secret, "000-000")).toBe(false);
  });
});

// ============================================================================
// Encryption Tests
// ============================================================================

describe("deriveKey", () => {
  it("should derive a CryptoKey", async () => {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const key = await deriveKey(secret);
    expect(key.type).toBe("secret");
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("should produce consistent keys with same inputs", async () => {
    const secret = new Uint8Array(32).fill(0x42);
    const salt = new Uint8Array(16).fill(0x01);

    // We can't directly compare CryptoKeys, but we can verify
    // encryption/decryption works with same derivation
    const key1 = await deriveKey(secret, salt);
    const key2 = await deriveKey(secret, salt);

    const data = new Uint8Array([1, 2, 3, 4]);
    const encrypted = await encryptAesGcm(data, key1);
    const decrypted = await decryptAesGcm(encrypted, key2);
    expect(decrypted).toEqual(data);
  });
});

describe("encryptAesGcm / decryptAesGcm", () => {
  it("should encrypt and decrypt data", async () => {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const key = await deriveKey(secret);

    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encrypted = await encryptAesGcm(data, key);
    const decrypted = await decryptAesGcm(encrypted, key);

    expect(decrypted).toEqual(data);
  });

  it("should produce different ciphertext each time (random IV)", async () => {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const key = await deriveKey(secret);

    const data = new Uint8Array([1, 2, 3, 4]);
    const e1 = await encryptAesGcm(data, key);
    const e2 = await encryptAesGcm(data, key);

    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
  });

  it("should fail with wrong key", async () => {
    const secret1 = new Uint8Array(32).fill(1);
    const secret2 = new Uint8Array(32).fill(2);
    const key1 = await deriveKey(secret1);
    const key2 = await deriveKey(secret2);

    const data = new Uint8Array([1, 2, 3, 4]);
    const encrypted = await encryptAesGcm(data, key1);

    await expect(decryptAesGcm(encrypted, key2)).rejects.toThrow();
  });
});

describe("encryptToken / decryptToken", () => {
  it("should encrypt and decrypt token", async () => {
    const token = new Uint8Array(128);
    crypto.getRandomValues(token);
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);

    const encrypted = await encryptToken(token, secret);
    const decrypted = await decryptToken(encrypted, secret);

    expect(decrypted).toEqual(token);
  });
});

describe("formatEncryptedToken / parseEncryptedToken", () => {
  it("should format as iv.ciphertext.tag", () => {
    const encrypted = {
      iv: "aGVsbG8=",
      ciphertext: "d29ybGQ=",
      tag: "dGVzdA==",
    };
    const formatted = formatEncryptedToken(encrypted);
    expect(formatted).toBe("aGVsbG8=.d29ybGQ=.dGVzdA==");
  });

  it("should parse formatted string", () => {
    const formatted = "aGVsbG8=.d29ybGQ=.dGVzdA==";
    const parsed = parseEncryptedToken(formatted);
    expect(parsed.iv).toBe("aGVsbG8=");
    expect(parsed.ciphertext).toBe("d29ybGQ=");
    expect(parsed.tag).toBe("dGVzdA==");
  });

  it("should roundtrip format/parse", async () => {
    const token = new Uint8Array(128);
    crypto.getRandomValues(token);
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);

    const encrypted = await encryptToken(token, secret);
    const formatted = formatEncryptedToken(encrypted);
    const parsed = parseEncryptedToken(formatted);

    expect(parsed.iv).toBe(encrypted.iv);
    expect(parsed.ciphertext).toBe(encrypted.ciphertext);
    expect(parsed.tag).toBe(encrypted.tag);
  });

  it("should throw on invalid format", () => {
    expect(() => parseEncryptedToken("only.two")).toThrow(/expected 3 parts/);
    expect(() => parseEncryptedToken("single")).toThrow(/expected 3 parts/);
  });
});
