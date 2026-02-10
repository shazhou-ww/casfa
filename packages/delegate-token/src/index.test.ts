/**
 * Delegate Token tests — v3 (simplified format)
 *
 * AT (32 bytes): [delegateId 16B] [expiresAt 8B LE] [nonce 8B]
 * RT (24 bytes): [delegateId 16B] [nonce 8B]
 * Distinguished by byte length, no magic, no type byte.
 */

import { describe, expect, it } from "bun:test";
import { blake3 } from "@noble/hashes/blake3";
import {
  AT_SIZE,
  computeTokenId,
  type DecodedAccessToken,
  type DecodedRefreshToken,
  decodeToken,
  DELEGATE_ID_SIZE,
  encodeAccessToken,
  encodeRefreshToken,
  type EncodeAccessTokenInput,
  type EncodeRefreshTokenInput,
  formatTokenId,
  type HashFunction,
  isValidTokenIdFormat,
  NONCE_SIZE,
  parseTokenId,
  RT_SIZE,
  TOKEN_ID_PREFIX,
  validateToken,
  validateTokenBytes,
} from "./index.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/** Blake3-128 hash function for testing */
const blake3_128: HashFunction = (data: Uint8Array): Uint8Array => {
  return blake3(data, { dkLen: 16 });
};

/** Create a random 16-byte delegateId */
function makeDelegateId(): Uint8Array {
  const id = new Uint8Array(DELEGATE_ID_SIZE);
  crypto.getRandomValues(id);
  return id;
}

/** Create AT input with sensible defaults */
function createATInput(overrides: Partial<EncodeAccessTokenInput> = {}): EncodeAccessTokenInput {
  return {
    delegateId: makeDelegateId(),
    expiresAt: Date.now() + 3600_000, // 1 hour
    ...overrides,
  };
}

/** Create RT input with sensible defaults */
function createRTInput(overrides: Partial<EncodeRefreshTokenInput> = {}): EncodeRefreshTokenInput {
  return {
    delegateId: makeDelegateId(),
    ...overrides,
  };
}

// ============================================================================
// Encoding Tests
// ============================================================================

describe("encodeAccessToken", () => {
  it("should produce exactly 32 bytes", () => {
    const bytes = encodeAccessToken(createATInput());
    expect(bytes.length).toBe(AT_SIZE);
  });

  it("should write delegateId at offset 0", () => {
    const delegateId = makeDelegateId();
    const bytes = encodeAccessToken(createATInput({ delegateId }));
    expect(bytes.slice(0, 16)).toEqual(delegateId);
  });

  it("should write expiresAt at offset 16 (u64 LE)", () => {
    const expiresAt = 1700000000000;
    const bytes = encodeAccessToken(createATInput({ expiresAt }));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Number(view.getBigUint64(16, true))).toBe(expiresAt);
  });

  it("should write 8-byte nonce at offset 24", () => {
    const bytes = encodeAccessToken(createATInput());
    const nonce = bytes.slice(24, 32);
    expect(nonce.length).toBe(NONCE_SIZE);
    // Nonce should not be all zeros (cryptographically random)
    expect(nonce.some((b) => b !== 0)).toBe(true);
  });

  it("should generate different nonces on each call", () => {
    const input = createATInput();
    const bytes1 = encodeAccessToken(input);
    const bytes2 = encodeAccessToken(input);
    // nonce is at offset 24-32
    expect(bytes1.slice(24, 32)).not.toEqual(bytes2.slice(24, 32));
  });

  it("should throw on invalid delegateId length", () => {
    expect(() =>
      encodeAccessToken({ delegateId: new Uint8Array(8), expiresAt: Date.now() + 1000 })
    ).toThrow(/Invalid delegateId length/);
  });
});

describe("encodeRefreshToken", () => {
  it("should produce exactly 24 bytes", () => {
    const bytes = encodeRefreshToken(createRTInput());
    expect(bytes.length).toBe(RT_SIZE);
  });

  it("should write delegateId at offset 0", () => {
    const delegateId = makeDelegateId();
    const bytes = encodeRefreshToken(createRTInput({ delegateId }));
    expect(bytes.slice(0, 16)).toEqual(delegateId);
  });

  it("should write 8-byte nonce at offset 16", () => {
    const bytes = encodeRefreshToken(createRTInput());
    const nonce = bytes.slice(16, 24);
    expect(nonce.length).toBe(NONCE_SIZE);
    expect(nonce.some((b) => b !== 0)).toBe(true);
  });

  it("should throw on invalid delegateId length", () => {
    expect(() => encodeRefreshToken({ delegateId: new Uint8Array(32) })).toThrow(
      /Invalid delegateId length/
    );
  });
});

// ============================================================================
// Decoding Tests
// ============================================================================

describe("decodeToken", () => {
  it("should decode 32-byte input as Access Token", () => {
    const delegateId = makeDelegateId();
    const expiresAt = Date.now() + 3600_000;
    const bytes = encodeAccessToken({ delegateId, expiresAt });
    const decoded = decodeToken(bytes);

    expect(decoded.type).toBe("access");
    expect(decoded.delegateId).toEqual(delegateId);
    expect((decoded as DecodedAccessToken).expiresAt).toBe(expiresAt);
    expect((decoded as DecodedAccessToken).nonce.length).toBe(NONCE_SIZE);
  });

  it("should decode 24-byte input as Refresh Token", () => {
    const delegateId = makeDelegateId();
    const bytes = encodeRefreshToken({ delegateId });
    const decoded = decodeToken(bytes);

    expect(decoded.type).toBe("refresh");
    expect(decoded.delegateId).toEqual(delegateId);
    expect((decoded as DecodedRefreshToken).nonce.length).toBe(NONCE_SIZE);
  });

  it("should throw on invalid size (128 bytes — old format)", () => {
    expect(() => decodeToken(new Uint8Array(128))).toThrow(/Invalid token size/);
  });

  it("should throw on invalid size (0 bytes)", () => {
    expect(() => decodeToken(new Uint8Array(0))).toThrow(/Invalid token size/);
  });

  it("should throw on invalid size (30 bytes)", () => {
    expect(() => decodeToken(new Uint8Array(30))).toThrow(/Invalid token size/);
  });
});

// ============================================================================
// Round-trip Tests
// ============================================================================

describe("encode/decode roundtrip", () => {
  it("should preserve AT fields through encode/decode", () => {
    const delegateId = makeDelegateId();
    const expiresAt = Date.now() + 86400_000;

    const bytes = encodeAccessToken({ delegateId, expiresAt });
    const decoded = decodeToken(bytes);

    expect(decoded.type).toBe("access");
    expect(decoded.delegateId).toEqual(delegateId);
    if (decoded.type === "access") {
      expect(decoded.expiresAt).toBe(expiresAt);
      expect(decoded.nonce.length).toBe(NONCE_SIZE);
    }
  });

  it("should preserve RT fields through encode/decode", () => {
    const delegateId = makeDelegateId();

    const bytes = encodeRefreshToken({ delegateId });
    const decoded = decodeToken(bytes);

    expect(decoded.type).toBe("refresh");
    expect(decoded.delegateId).toEqual(delegateId);
    if (decoded.type === "refresh") {
      expect(decoded.nonce.length).toBe(NONCE_SIZE);
    }
  });

  it("should produce unique tokens (different nonces) for same delegateId", () => {
    const delegateId = makeDelegateId();
    const expiresAt = Date.now() + 3600_000;

    const bytes1 = encodeAccessToken({ delegateId, expiresAt });
    const bytes2 = encodeAccessToken({ delegateId, expiresAt });

    // Full token bytes differ (nonce is different)
    expect(bytes1).not.toEqual(bytes2);
    // But delegateId and expiresAt are the same
    expect(bytes1.slice(0, 24)).toEqual(bytes2.slice(0, 24));
  });

  it("should handle expiresAt=0 in AT (edge case)", () => {
    const delegateId = makeDelegateId();
    const bytes = encodeAccessToken({ delegateId, expiresAt: 0 });
    const decoded = decodeToken(bytes);

    expect(decoded.type).toBe("access");
    if (decoded.type === "access") {
      expect(decoded.expiresAt).toBe(0);
    }
  });

  it("should handle max expiresAt value", () => {
    const delegateId = makeDelegateId();
    // Max safe integer for epoch ms
    const expiresAt = Number.MAX_SAFE_INTEGER;
    const bytes = encodeAccessToken({ delegateId, expiresAt });
    const decoded = decodeToken(bytes);

    if (decoded.type === "access") {
      expect(decoded.expiresAt).toBe(expiresAt);
    }
  });
});

// ============================================================================
// Token ID Tests
// ============================================================================

describe("computeTokenId", () => {
  it("should compute a 16-byte hash from AT", async () => {
    const bytes = encodeAccessToken(createATInput());
    const id = await computeTokenId(bytes, blake3_128);
    expect(id.length).toBe(16);
  });

  it("should compute a 16-byte hash from RT", async () => {
    const bytes = encodeRefreshToken(createRTInput());
    const id = await computeTokenId(bytes, blake3_128);
    expect(id.length).toBe(16);
  });

  it("should return different IDs for different tokens", async () => {
    const bytes1 = encodeAccessToken(createATInput());
    const bytes2 = encodeAccessToken(createATInput());

    const id1 = await computeTokenId(bytes1, blake3_128);
    const id2 = await computeTokenId(bytes2, blake3_128);

    expect(id1).not.toEqual(id2);
  });

  it("should throw if hash function returns wrong length", async () => {
    const bytes = encodeAccessToken(createATInput());
    const badHashFn: HashFunction = () => new Uint8Array(32);

    await expect(computeTokenId(bytes, badHashFn)).rejects.toThrow(
      /Hash function must return 16 bytes/
    );
  });
});

describe("formatTokenId", () => {
  it("should format with tkn_ prefix", () => {
    const id = new Uint8Array(16).fill(0);
    expect(formatTokenId(id).startsWith(TOKEN_ID_PREFIX)).toBe(true);
  });

  it("should produce 30 character string (4 prefix + 26 base32)", () => {
    const id = new Uint8Array(16).fill(0);
    expect(formatTokenId(id).length).toBe(30); // "tkn_" (4) + 26 base32 chars
  });

  it("should throw on invalid length", () => {
    expect(() => formatTokenId(new Uint8Array(8))).toThrow(/Invalid Token ID length/);
  });
});

describe("parseTokenId", () => {
  it("should round-trip through format/parse", () => {
    const original = new Uint8Array(16).fill(0x5a);
    const formatted = formatTokenId(original);
    const parsed = parseTokenId(formatted);
    expect(parsed).toEqual(original);
  });

  it("should throw on missing prefix", () => {
    expect(() => parseTokenId("0000000000000000000000000")).toThrow(/must start with/);
  });

  it("should throw on wrong length", () => {
    expect(() => parseTokenId("tkn_SHORT")).toThrow(/Invalid Token ID length/);
  });
});

describe("isValidTokenIdFormat", () => {
  it("should return true for valid format", () => {
    const id = formatTokenId(new Uint8Array(16).fill(0));
    expect(isValidTokenIdFormat(id)).toBe(true);
  });

  it("should return false for missing prefix", () => {
    expect(isValidTokenIdFormat("00000000000000000000000000")).toBe(false);
  });

  it("should return false for invalid characters", () => {
    expect(isValidTokenIdFormat("tkn_0000000000000000000000!@")).toBe(false);
  });

  it("should return false for wrong length", () => {
    expect(isValidTokenIdFormat("tkn_SHORT")).toBe(false);
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe("validateTokenBytes", () => {
  it("should pass for 32-byte AT", () => {
    const bytes = encodeAccessToken(createATInput());
    expect(validateTokenBytes(bytes).valid).toBe(true);
  });

  it("should pass for 24-byte RT", () => {
    const bytes = encodeRefreshToken(createRTInput());
    expect(validateTokenBytes(bytes).valid).toBe(true);
  });

  it("should fail for 128 bytes (old format)", () => {
    const result = validateTokenBytes(new Uint8Array(128));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("invalid_size");
  });

  it("should fail for 0 bytes", () => {
    const result = validateTokenBytes(new Uint8Array(0));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("invalid_size");
  });
});

describe("validateToken", () => {
  it("should pass for valid Access Token (not expired)", () => {
    const bytes = encodeAccessToken(createATInput({ expiresAt: Date.now() + 3600_000 }));
    const decoded = decodeToken(bytes);
    expect(validateToken(decoded).valid).toBe(true);
  });

  it("should pass for Refresh Token (no TTL)", () => {
    const bytes = encodeRefreshToken(createRTInput());
    const decoded = decodeToken(bytes);
    expect(validateToken(decoded).valid).toBe(true);
  });

  it("should fail for expired Access Token", () => {
    const bytes = encodeAccessToken(createATInput({ expiresAt: Date.now() - 1000 }));
    const decoded = decodeToken(bytes);
    const result = validateToken(decoded);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("expired");
  });

  it("should accept custom time for AT validation", () => {
    const expiresAt = 1_000_000;
    const bytes = encodeAccessToken(createATInput({ expiresAt }));
    const decoded = decodeToken(bytes);

    expect(validateToken(decoded, 500_000).valid).toBe(true);
    expect(validateToken(decoded, 2_000_000).valid).toBe(false);
  });

  it("should always pass for RT regardless of time", () => {
    const bytes = encodeRefreshToken(createRTInput());
    const decoded = decodeToken(bytes);

    expect(validateToken(decoded, 0).valid).toBe(true);
    expect(validateToken(decoded, Number.MAX_SAFE_INTEGER).valid).toBe(true);
  });
});

// ============================================================================
// Size & Format Property Tests
// ============================================================================

describe("format properties", () => {
  it("AT base64 should be 44 characters", () => {
    const bytes = encodeAccessToken(createATInput());
    const base64 = Buffer.from(bytes).toString("base64");
    expect(base64.length).toBe(44);
  });

  it("RT base64 should be 32 characters", () => {
    const bytes = encodeRefreshToken(createRTInput());
    const base64 = Buffer.from(bytes).toString("base64");
    expect(base64.length).toBe(32);
  });

  it("AT should be 75% smaller than old 128-byte format", () => {
    expect(AT_SIZE).toBe(32);
    expect(AT_SIZE / 128).toBe(0.25);
  });

  it("RT should be 81% smaller than old 128-byte format", () => {
    expect(RT_SIZE).toBe(24);
    expect(RT_SIZE / 128).toBe(0.1875);
  });

  it("AT and RT have different sizes (length-based discrimination)", () => {
    expect(AT_SIZE).not.toBe(RT_SIZE);
  });
});
