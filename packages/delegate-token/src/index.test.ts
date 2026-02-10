/**
 * Delegate Token tests — v2 (Delegate-as-entity model)
 *
 * Flags layout:
 *   Low nibble:  bit 0 is_refresh, bit 1 can_upload, bit 2 can_manage_depot, bit 3 reserved
 *   High nibble: bits 4-7 depth (0-15)
 */

import { describe, expect, it } from "bun:test";
import { blake3 } from "@noble/hashes/blake3";
import {
  // Token ID
  computeTokenId,
  // Constants
  DELEGATE_TOKEN_SIZE,
  type DelegateTokenInput,
  // Encoding/Decoding
  decodeDelegateToken,
  encodeDelegateToken,
  FLAGS,
  formatTokenId,
  type HashFunction,
  isValidTokenIdFormat,
  MAGIC_NUMBER,
  MAX_DEPTH,
  parseTokenId,
  TOKEN_ID_PREFIX,
  // Validation
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

/** Create a 32-byte issuer field from a 16-byte UUID (left-padded) */
function makeIssuer(uuid: Uint8Array): Uint8Array {
  const issuer = new Uint8Array(32);
  issuer.set(uuid, 16); // left-padded: 16 zero bytes + 16 UUID bytes
  return issuer;
}

/** Create test input with sensible defaults */
function createTestInput(overrides: Partial<DelegateTokenInput> = {}): DelegateTokenInput {
  const now = Date.now();
  return {
    type: "access",
    ttl: now + 3600000, // 1 hour
    canUpload: false,
    canManageDepot: false,
    quota: 0,
    issuer: makeIssuer(new Uint8Array(16).fill(0xaa)),
    realm: new Uint8Array(32).fill(2),
    scope: new Uint8Array(32), // all zeros = root scope
    depth: 0,
    ...overrides,
  };
}

// ============================================================================
// Encoding Tests
// ============================================================================

describe("encodeDelegateToken", () => {
  it("should encode a token to 128 bytes", () => {
    const bytes = encodeDelegateToken(createTestInput());
    expect(bytes.length).toBe(DELEGATE_TOKEN_SIZE);
  });

  it("should write correct magic number (LE)", () => {
    const bytes = encodeDelegateToken(createTestInput());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(MAGIC_NUMBER);
  });

  it("should encode Refresh Token type (bit 0 = 1)", () => {
    const rt = encodeDelegateToken(createTestInput({ type: "refresh", ttl: 0 }));
    const at = encodeDelegateToken(createTestInput({ type: "access" }));

    const rtFlags = new DataView(rt.buffer).getUint32(4, true);
    const atFlags = new DataView(at.buffer).getUint32(4, true);

    expect((rtFlags >> FLAGS.IS_REFRESH) & 1).toBe(1);
    expect((atFlags >> FLAGS.IS_REFRESH) & 1).toBe(0);
  });

  it("should encode permission flags (bits 1-2)", () => {
    const bytes = encodeDelegateToken(createTestInput({ canUpload: true, canManageDepot: true }));
    const flags = new DataView(bytes.buffer).getUint32(4, true);

    expect((flags >> FLAGS.CAN_UPLOAD) & 1).toBe(1);
    expect((flags >> FLAGS.CAN_MANAGE_DEPOT) & 1).toBe(1);
  });

  it("should encode depth in high nibble (bits 4-7)", () => {
    const bytes = encodeDelegateToken(createTestInput({ depth: 5 }));
    const flags = new DataView(bytes.buffer).getUint32(4, true);
    const depth = (flags >> FLAGS.DEPTH_SHIFT) & FLAGS.DEPTH_MASK;

    expect(depth).toBe(5);
  });

  it("should keep reserved bit 3 clear", () => {
    const bytes = encodeDelegateToken(
      createTestInput({ type: "refresh", ttl: 0, canUpload: true, canManageDepot: true, depth: 15 })
    );
    const flags = new DataView(bytes.buffer).getUint32(4, true);

    expect((flags >> FLAGS.RESERVED) & 1).toBe(0);
  });

  it("should throw on invalid issuer length", () => {
    expect(() => encodeDelegateToken(createTestInput({ issuer: new Uint8Array(16) }))).toThrow(
      /Invalid issuer length/
    );
  });

  it("should throw on invalid realm length", () => {
    expect(() => encodeDelegateToken(createTestInput({ realm: new Uint8Array(16) }))).toThrow(
      /Invalid realm length/
    );
  });

  it("should throw on invalid scope length", () => {
    expect(() => encodeDelegateToken(createTestInput({ scope: new Uint8Array(16) }))).toThrow(
      /Invalid scope length/
    );
  });

  it("should throw when depth > MAX_DEPTH", () => {
    expect(() => encodeDelegateToken(createTestInput({ depth: 16 }))).toThrow(
      /Delegation depth out of range/
    );
  });

  it("should throw when depth < 0", () => {
    expect(() => encodeDelegateToken(createTestInput({ depth: -1 }))).toThrow(
      /Delegation depth out of range/
    );
  });
});

// ============================================================================
// Decoding Tests
// ============================================================================

describe("decodeDelegateToken", () => {
  it("should decode an encoded Access Token correctly", () => {
    const input = createTestInput({
      type: "access",
      canUpload: true,
      canManageDepot: true,
      quota: 1000,
      depth: 2,
    });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    expect(decoded.flags.isRefresh).toBe(false);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(true);
    expect(decoded.flags.depth).toBe(2);
    expect(decoded.ttl).toBe(input.ttl);
    expect(decoded.quota).toBe(1000);
    expect(decoded.issuer).toEqual(input.issuer);
    expect(decoded.realm).toEqual(input.realm);
    expect(decoded.scope).toEqual(input.scope);
  });

  it("should decode a Refresh Token correctly", () => {
    const input = createTestInput({
      type: "refresh",
      ttl: 0,
      canUpload: true,
      canManageDepot: true,
      depth: 0,
    });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    expect(decoded.flags.isRefresh).toBe(true);
    expect(decoded.ttl).toBe(0);
  });

  it("should throw on invalid size", () => {
    expect(() => decodeDelegateToken(new Uint8Array(64))).toThrow(/Invalid token size/);
  });

  it("should throw on invalid magic number", () => {
    expect(() => decodeDelegateToken(new Uint8Array(DELEGATE_TOKEN_SIZE))).toThrow(
      /Invalid magic number/
    );
  });
});

// ============================================================================
// Round-trip Tests
// ============================================================================

describe("encode/decode roundtrip", () => {
  it("should preserve all fields — root delegate AT", () => {
    const ttl = Date.now() + 86400000;
    const input = createTestInput({
      type: "access",
      ttl,
      canUpload: true,
      canManageDepot: true,
      depth: 0,
    });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.flags.isRefresh).toBe(false);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(true);
    expect(decoded.flags.depth).toBe(0);
    expect(decoded.ttl).toBe(ttl);
  });

  it("should preserve all fields — root delegate RT", () => {
    const input = createTestInput({
      type: "refresh",
      ttl: 0,
      canUpload: true,
      canManageDepot: true,
      depth: 0,
    });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.flags.isRefresh).toBe(true);
    expect(decoded.flags.depth).toBe(0);
    expect(decoded.ttl).toBe(0);
  });

  it("should preserve all fields — child delegate AT with upload, depth=2", () => {
    const ttl = Date.now() + 3600000;
    const input = createTestInput({
      type: "access",
      ttl,
      canUpload: true,
      canManageDepot: true,
      depth: 2,
    });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.flags.isRefresh).toBe(false);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(true);
    expect(decoded.flags.depth).toBe(2);
    expect(decoded.ttl).toBe(ttl);
  });

  it("should preserve all fields — read-only AT, depth=1", () => {
    const ttl = Date.now() + 3600000;
    const input = createTestInput({
      type: "access",
      ttl,
      canUpload: false,
      canManageDepot: false,
      depth: 1,
    });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.flags.isRefresh).toBe(false);
    expect(decoded.flags.canUpload).toBe(false);
    expect(decoded.flags.canManageDepot).toBe(false);
    expect(decoded.flags.depth).toBe(1);
  });

  it("should preserve all fields — tool AT (upload, no depot, depth=3)", () => {
    const ttl = Date.now() + 1800000;
    const input = createTestInput({
      type: "access",
      ttl,
      canUpload: true,
      canManageDepot: false,
      depth: 3,
    });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.flags.isRefresh).toBe(false);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(false);
    expect(decoded.flags.depth).toBe(3);
  });

  it("should preserve all fields — max depth=15", () => {
    const input = createTestInput({ depth: MAX_DEPTH });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.flags.depth).toBe(15);
  });

  it("should match design doc §3.4 flags examples", () => {
    // Root AT: 0x06 — is_refresh=0, can_upload=1, can_manage_depot=1, depth=0
    const rootAT = encodeDelegateToken(
      createTestInput({ type: "access", canUpload: true, canManageDepot: true, depth: 0 })
    );
    expect(new DataView(rootAT.buffer).getUint32(4, true) & 0xff).toBe(0x06);

    // Root RT: 0x07
    const rootRT = encodeDelegateToken(
      createTestInput({ type: "refresh", ttl: 0, canUpload: true, canManageDepot: true, depth: 0 })
    );
    expect(new DataView(rootRT.buffer).getUint32(4, true) & 0xff).toBe(0x07);

    // Child AT depth=2, upload+depot: 0x26
    const childAT = encodeDelegateToken(
      createTestInput({ type: "access", canUpload: true, canManageDepot: true, depth: 2 })
    );
    expect(new DataView(childAT.buffer).getUint32(4, true) & 0xff).toBe(0x26);

    // Read-only AT depth=1: 0x10
    const readOnly = encodeDelegateToken(
      createTestInput({ type: "access", canUpload: false, canManageDepot: false, depth: 1 })
    );
    expect(new DataView(readOnly.buffer).getUint32(4, true) & 0xff).toBe(0x10);

    // Tool AT upload, no depot, depth=3: 0x32
    const toolAT = encodeDelegateToken(
      createTestInput({ type: "access", canUpload: true, canManageDepot: false, depth: 3 })
    );
    expect(new DataView(toolAT.buffer).getUint32(4, true) & 0xff).toBe(0x32);
  });

  it("should preserve issuer with left-padded UUID format", () => {
    const uuid = new Uint8Array(16);
    crypto.getRandomValues(uuid);
    const issuer = makeIssuer(uuid);

    const input = createTestInput({ issuer });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    // First 16 bytes should be zero (padding)
    expect(decoded.issuer.slice(0, 16)).toEqual(new Uint8Array(16));
    // Last 16 bytes should be UUID
    expect(decoded.issuer.slice(16)).toEqual(uuid);
  });

  it("should preserve scope with left-padded CAS hash", () => {
    const hash = new Uint8Array(16);
    crypto.getRandomValues(hash);
    const scope = new Uint8Array(32);
    scope.set(hash, 16); // left-padded

    const input = createTestInput({ scope });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.scope).toEqual(scope);
  });

  it("should preserve all-zero scope (root delegate)", () => {
    const scope = new Uint8Array(32); // all zeros
    const input = createTestInput({ scope });
    const decoded = decodeDelegateToken(encodeDelegateToken(input));

    expect(decoded.scope).toEqual(scope);
  });

  it("nibble extraction: flags & 0x0F = permissions, flags >> 4 = depth", () => {
    const bytes = encodeDelegateToken(
      createTestInput({ type: "refresh", ttl: 0, canUpload: true, canManageDepot: true, depth: 7 })
    );
    const flags = new DataView(bytes.buffer).getUint32(4, true);

    const perms = flags & 0x0f;
    const depth = flags >> 4;

    // is_refresh=1, can_upload=1, can_manage_depot=1 → low nibble = 0b0111 = 7
    expect(perms).toBe(0x07);
    expect(depth).toBe(7);
  });
});

// ============================================================================
// Token ID Tests
// ============================================================================

describe("computeTokenId", () => {
  it("should compute a 16-byte hash", async () => {
    const bytes = encodeDelegateToken(createTestInput());
    const id = await computeTokenId(bytes, blake3_128);
    expect(id.length).toBe(16);
  });

  it("should return different IDs for different tokens", async () => {
    const bytes1 = encodeDelegateToken(createTestInput({ ttl: 1000 }));
    const bytes2 = encodeDelegateToken(createTestInput({ ttl: 2000 }));

    const id1 = await computeTokenId(bytes1, blake3_128);
    const id2 = await computeTokenId(bytes2, blake3_128);

    expect(id1).not.toEqual(id2);
  });

  it("should throw if hash function returns wrong length", async () => {
    const bytes = encodeDelegateToken(createTestInput());
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

  it("should produce 31 character string (5 prefix + 26 base32)", () => {
    const id = new Uint8Array(16).fill(0);
    expect(formatTokenId(id).length).toBe(31);
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

describe("validateToken", () => {
  it("should pass for valid Access Token", () => {
    const bytes = encodeDelegateToken(createTestInput({ ttl: Date.now() + 3600000 }));
    const decoded = decodeDelegateToken(bytes);
    expect(validateToken(decoded).valid).toBe(true);
  });

  it("should pass for valid Refresh Token (ttl=0)", () => {
    const bytes = encodeDelegateToken(createTestInput({ type: "refresh", ttl: 0 }));
    const decoded = decodeDelegateToken(bytes);
    expect(validateToken(decoded).valid).toBe(true);
  });

  it("should fail for expired Access Token", () => {
    const bytes = encodeDelegateToken(createTestInput({ ttl: Date.now() - 1000 }));
    const decoded = decodeDelegateToken(bytes);
    const result = validateToken(decoded);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("expired");
  });

  it("should fail for Refresh Token with non-zero ttl", () => {
    const bytes = encodeDelegateToken(createTestInput({ type: "refresh", ttl: 0 }));
    const decoded = decodeDelegateToken(bytes);
    // Manually corrupt ttl to non-zero
    decoded.ttl = Date.now() + 1000;

    const result = validateToken(decoded);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("invalid_flags");
  });

  it("should accept custom time for AT validation", () => {
    const ttl = 1000000;
    const bytes = encodeDelegateToken(createTestInput({ ttl }));
    const decoded = decodeDelegateToken(bytes);

    expect(validateToken(decoded, 500000).valid).toBe(true);
    expect(validateToken(decoded, 2000000).valid).toBe(false);
  });

  it("should fail for depth exceeding MAX_DEPTH", () => {
    const bytes = encodeDelegateToken(createTestInput({ depth: MAX_DEPTH }));
    const decoded = decodeDelegateToken(bytes);
    // Manually corrupt depth
    decoded.flags.depth = 16;

    const result = validateToken(decoded);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("depth_exceeded");
  });
});

describe("validateTokenBytes", () => {
  it("should pass for valid bytes", () => {
    const bytes = encodeDelegateToken(createTestInput());
    expect(validateTokenBytes(bytes).valid).toBe(true);
  });

  it("should fail for invalid size", () => {
    const result = validateTokenBytes(new Uint8Array(64));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("invalid_size");
  });

  it("should fail for invalid magic", () => {
    const result = validateTokenBytes(new Uint8Array(DELEGATE_TOKEN_SIZE));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("invalid_magic");
  });
});
