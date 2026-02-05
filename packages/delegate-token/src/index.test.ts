/**
 * Delegate Token tests
 */

import { describe, it, expect } from "bun:test";
import { blake3 } from "@noble/hashes/blake3";
import {
  // Constants
  DELEGATE_TOKEN_SIZE,
  MAGIC_NUMBER,
  TOKEN_ID_PREFIX,
  MAX_DEPTH,
  FLAGS,
  // Types
  type DelegateToken,
  type DelegateTokenInput,
  type HashFunction,
  // Encoding/Decoding
  encodeDelegateToken,
  decodeDelegateToken,
  // Token ID
  computeTokenId,
  formatTokenId,
  parseTokenId,
  isValidTokenIdFormat,
  // Validation
  validateToken,
  validateTokenBytes,
} from "./index.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Blake3-128 hash function for testing
 */
const blake3_128: HashFunction = (data: Uint8Array): Uint8Array => {
  return blake3(data, { dkLen: 16 });
};

/**
 * Create test input with defaults
 */
function createTestInput(overrides: Partial<DelegateTokenInput> = {}): DelegateTokenInput {
  const now = Date.now();
  return {
    type: "delegate",
    ttl: now + 3600000, // 1 hour
    canUpload: false,
    canManageDepot: false,
    quota: 0,
    issuer: new Uint8Array(32).fill(1),
    realm: new Uint8Array(32).fill(2),
    scope: new Uint8Array(32).fill(3),
    isUserIssued: true,
    ...overrides,
  };
}

// ============================================================================
// Encoding/Decoding Tests
// ============================================================================

describe("encodeDelegateToken", () => {
  it("should encode a token to 128 bytes", () => {
    const input = createTestInput();
    const bytes = encodeDelegateToken(input);
    expect(bytes.length).toBe(DELEGATE_TOKEN_SIZE);
  });

  it("should write correct magic number", () => {
    const input = createTestInput();
    const bytes = encodeDelegateToken(input);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(MAGIC_NUMBER);
  });

  it("should encode delegate type correctly", () => {
    const delegate = encodeDelegateToken(createTestInput({ type: "delegate" }));
    const access = encodeDelegateToken(createTestInput({ type: "access" }));

    const delegateFlags = new DataView(delegate.buffer).getUint32(4, true);
    const accessFlags = new DataView(access.buffer).getUint32(4, true);

    expect((delegateFlags >> FLAGS.IS_DELEGATE) & 1).toBe(1);
    expect((accessFlags >> FLAGS.IS_DELEGATE) & 1).toBe(0);
  });

  it("should encode permission flags", () => {
    const input = createTestInput({
      canUpload: true,
      canManageDepot: true,
    });
    const bytes = encodeDelegateToken(input);
    const flags = new DataView(bytes.buffer).getUint32(4, true);

    expect((flags >> FLAGS.CAN_UPLOAD) & 1).toBe(1);
    expect((flags >> FLAGS.CAN_MANAGE_DEPOT) & 1).toBe(1);
  });

  it("should encode depth correctly for delegated token", () => {
    const input = createTestInput({
      isUserIssued: false,
      parentDepth: 3,
    });
    const bytes = encodeDelegateToken(input);
    const flags = new DataView(bytes.buffer).getUint32(4, true);
    const depth = (flags >> FLAGS.DEPTH_SHIFT) & 0x0f;

    expect(depth).toBe(4); // parentDepth + 1
  });

  it("should throw on invalid issuer length", () => {
    const input = createTestInput({
      issuer: new Uint8Array(16), // Wrong size
    });
    expect(() => encodeDelegateToken(input)).toThrow(/Invalid issuer length/);
  });

  it("should throw on invalid realm length", () => {
    const input = createTestInput({
      realm: new Uint8Array(16), // Wrong size
    });
    expect(() => encodeDelegateToken(input)).toThrow(/Invalid realm length/);
  });

  it("should throw on invalid scope length", () => {
    const input = createTestInput({
      scope: new Uint8Array(16), // Wrong size
    });
    expect(() => encodeDelegateToken(input)).toThrow(/Invalid scope length/);
  });

  it("should throw when max depth exceeded", () => {
    const input = createTestInput({
      isUserIssued: false,
      parentDepth: MAX_DEPTH,
    });
    expect(() => encodeDelegateToken(input)).toThrow(/Maximum token delegation depth exceeded/);
  });
});

describe("decodeDelegateToken", () => {
  it("should decode an encoded token correctly", () => {
    const input = createTestInput({
      type: "delegate",
      canUpload: true,
      canManageDepot: true,
      quota: 1000,
    });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    expect(decoded.flags.isDelegate).toBe(true);
    expect(decoded.flags.isUserIssued).toBe(true);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(true);
    expect(decoded.flags.depth).toBe(0);
    expect(decoded.ttl).toBe(input.ttl);
    expect(decoded.quota).toBe(1000);
    expect(decoded.issuer).toEqual(input.issuer);
    expect(decoded.realm).toEqual(input.realm);
    expect(decoded.scope).toEqual(input.scope);
  });

  it("should decode access token correctly", () => {
    const input = createTestInput({ type: "access" });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    expect(decoded.flags.isDelegate).toBe(false);
  });

  it("should throw on invalid size", () => {
    const bytes = new Uint8Array(64);
    expect(() => decodeDelegateToken(bytes)).toThrow(/Invalid token size/);
  });

  it("should throw on invalid magic number", () => {
    const bytes = new Uint8Array(DELEGATE_TOKEN_SIZE);
    expect(() => decodeDelegateToken(bytes)).toThrow(/Invalid magic number/);
  });
});

describe("encode/decode roundtrip", () => {
  it("should preserve all fields through encode/decode", () => {
    const ttl = Date.now() + 86400000;
    const input = createTestInput({
      type: "delegate",
      ttl,
      canUpload: true,
      canManageDepot: false,
      quota: 999999,
      isUserIssued: false,
      parentDepth: 5,
    });

    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    expect(decoded.flags.isDelegate).toBe(true);
    expect(decoded.flags.isUserIssued).toBe(false);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(false);
    expect(decoded.flags.depth).toBe(6); // parentDepth + 1
    expect(decoded.ttl).toBe(ttl);
    expect(decoded.quota).toBe(999999);
  });
});

// ============================================================================
// Token ID Tests
// ============================================================================

describe("computeTokenId", () => {
  it("should compute a 16-byte hash", async () => {
    const input = createTestInput();
    const bytes = encodeDelegateToken(input);
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
    const badHashFn: HashFunction = () => new Uint8Array(32); // Wrong size

    await expect(computeTokenId(bytes, badHashFn)).rejects.toThrow(
      /Hash function must return 16 bytes/
    );
  });
});

describe("formatTokenId", () => {
  it("should format with dlt1_ prefix", () => {
    const id = new Uint8Array(16).fill(0);
    const formatted = formatTokenId(id);

    expect(formatted.startsWith(TOKEN_ID_PREFIX)).toBe(true);
  });

  it("should produce 31 character string (5 prefix + 26 base32)", () => {
    const id = new Uint8Array(16).fill(0);
    const formatted = formatTokenId(id);

    expect(formatted.length).toBe(31);
  });

  it("should throw on invalid length", () => {
    const id = new Uint8Array(8);
    expect(() => formatTokenId(id)).toThrow(/Invalid Token ID length/);
  });
});

describe("parseTokenId", () => {
  it("should parse valid token ID", () => {
    const original = new Uint8Array(16).fill(0x5a);
    const formatted = formatTokenId(original);
    const parsed = parseTokenId(formatted);

    expect(parsed).toEqual(original);
  });

  it("should throw on missing prefix", () => {
    expect(() => parseTokenId("0000000000000000000000000")).toThrow(
      /must start with/
    );
  });

  it("should throw on wrong length", () => {
    expect(() => parseTokenId("dlt1_SHORT")).toThrow(/Invalid Token ID length/);
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
    expect(isValidTokenIdFormat("dlt1_0000000000000000000000!@")).toBe(false);
  });

  it("should return false for wrong length", () => {
    expect(isValidTokenIdFormat("dlt1_SHORT")).toBe(false);
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe("validateToken", () => {
  it("should pass for valid token", () => {
    const input = createTestInput({
      ttl: Date.now() + 3600000,
    });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);
    const result = validateToken(decoded);

    expect(result.valid).toBe(true);
  });

  it("should fail for expired token", () => {
    const input = createTestInput({
      ttl: Date.now() - 1000, // Already expired
    });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);
    const result = validateToken(decoded);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("expired");
    }
  });

  it("should fail for invalid flags (user-issued with depth > 0)", () => {
    const input = createTestInput();
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    // Manually corrupt the depth
    decoded.flags.depth = 5;

    const result = validateToken(decoded);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("invalid_flags");
    }
  });

  it("should fail for invalid flags (delegated with depth 0)", () => {
    const input = createTestInput({ isUserIssued: false, parentDepth: 0 });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    // Manually corrupt to depth 0
    decoded.flags.depth = 0;

    const result = validateToken(decoded);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("invalid_flags");
    }
  });

  it("should accept custom time for validation", () => {
    const ttl = 1000000;
    const input = createTestInput({ ttl });
    const bytes = encodeDelegateToken(input);
    const decoded = decodeDelegateToken(bytes);

    // Valid at time before ttl
    expect(validateToken(decoded, 500000).valid).toBe(true);

    // Invalid at time after ttl
    expect(validateToken(decoded, 2000000).valid).toBe(false);
  });
});

describe("validateTokenBytes", () => {
  it("should pass for valid bytes", () => {
    const input = createTestInput();
    const bytes = encodeDelegateToken(input);
    const result = validateTokenBytes(bytes);

    expect(result.valid).toBe(true);
  });

  it("should fail for invalid size", () => {
    const bytes = new Uint8Array(64);
    const result = validateTokenBytes(bytes);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("invalid_size");
    }
  });

  it("should fail for invalid magic", () => {
    const bytes = new Uint8Array(DELEGATE_TOKEN_SIZE);
    const result = validateTokenBytes(bytes);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("invalid_magic");
    }
  });
});
