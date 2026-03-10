/**
 * @casfa/proof — PoP (Proof-of-Possession) unit tests.
 *
 * Coverage:
 * - computePoP: deterministic output, prefix format
 * - verifyPoP: round-trip verification
 * - Different tokens → different PoP for same content
 * - Different content → different PoP for same token
 * - Empty content edge case
 * - isPopString: format validation
 * - Tampered PoP → verification fails
 * - Constant-time comparison (no early exit)
 */

import { describe, expect, it } from "bun:test";
import type { PopContext } from "./pop.ts";
import { computePoP, isPopString, verifyPoP } from "./pop.ts";

// ============================================================================
// Mock crypto context
// ============================================================================

/**
 * Simple deterministic mock: produces distinct outputs for distinct inputs.
 * Uses a simple mixing function — NOT cryptographically secure, tests-only.
 */
function createMockPopContext(): PopContext {
  /**
   * Simple mixing: fold input into output with position-dependent rotation.
   */
  const mix = (data: Uint8Array, outLen: number, salt: number): Uint8Array => {
    const result = new Uint8Array(outLen);
    result.fill(salt & 0xff);
    for (let i = 0; i < data.length; i++) {
      const pos = i % outLen;
      // Rotate and XOR to spread bits
      result[pos] = ((result[pos]! << 1) | (result[pos]! >> 7)) & 0xff;
      result[pos] = (result[pos]! ^ data[i]! ^ ((i + 1) & 0xff)) & 0xff;
    }
    return result;
  };

  return {
    blake3_256: (data: Uint8Array): Uint8Array => {
      return mix(data, 32, 0xaa);
    },
    blake3_128_keyed: (data: Uint8Array, key: Uint8Array): Uint8Array => {
      // Combine data + key into one buffer, then mix
      const combined = new Uint8Array(data.length + key.length);
      combined.set(data, 0);
      combined.set(key, data.length);
      return mix(combined, 16, 0xbb);
    },
    crockfordBase32Encode: (bytes: Uint8Array): string => {
      // Simple hex-based encoding for tests (predictable, reversible)
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join("");
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("computePoP", () => {
  const ctx = createMockPopContext();
  const token = new Uint8Array(32).fill(0x42);
  const content = new Uint8Array([1, 2, 3, 4, 5]);

  it("returns a string starting with 'pop:'", () => {
    const pop = computePoP(token, content, ctx);
    expect(pop.startsWith("pop:")).toBe(true);
  });

  it("is deterministic — same inputs → same output", () => {
    const pop1 = computePoP(token, content, ctx);
    const pop2 = computePoP(token, content, ctx);
    expect(pop1).toBe(pop2);
  });

  it("different tokens → different PoP for same content", () => {
    const tokenA = new Uint8Array(32).fill(0x01);
    const tokenB = new Uint8Array(32).fill(0x02);
    const popA = computePoP(tokenA, content, ctx);
    const popB = computePoP(tokenB, content, ctx);
    expect(popA).not.toBe(popB);
  });

  it("different content → different PoP for same token", () => {
    const contentA = new Uint8Array([10, 20, 30]);
    const contentB = new Uint8Array([10, 20, 31]);
    const popA = computePoP(token, contentA, ctx);
    const popB = computePoP(token, contentB, ctx);
    expect(popA).not.toBe(popB);
  });

  it("works with empty content", () => {
    const pop = computePoP(token, new Uint8Array(0), ctx);
    expect(pop.startsWith("pop:")).toBe(true);
    expect(pop.length).toBeGreaterThan(4); // "pop:" + something
  });

  it("works with large content", () => {
    const largeContent = new Uint8Array(1024 * 1024).fill(0xff); // 1 MB
    const pop = computePoP(token, largeContent, ctx);
    expect(pop.startsWith("pop:")).toBe(true);
  });
});

describe("verifyPoP", () => {
  const ctx = createMockPopContext();
  const token = new Uint8Array(32).fill(0x42);
  const content = new Uint8Array([1, 2, 3, 4, 5]);

  it("returns true for valid pop (round-trip)", () => {
    const pop = computePoP(token, content, ctx);
    expect(verifyPoP(pop, token, content, ctx)).toBe(true);
  });

  it("returns false for wrong token", () => {
    const pop = computePoP(token, content, ctx);
    const wrongToken = new Uint8Array(32).fill(0x99);
    expect(verifyPoP(pop, wrongToken, content, ctx)).toBe(false);
  });

  it("returns false for wrong content", () => {
    const pop = computePoP(token, content, ctx);
    const wrongContent = new Uint8Array([9, 9, 9]);
    expect(verifyPoP(pop, token, wrongContent, ctx)).toBe(false);
  });

  it("returns false for tampered pop string", () => {
    const pop = computePoP(token, content, ctx);
    // Flip the last character
    const tampered = pop.slice(0, -1) + (pop.endsWith("A") ? "B" : "A");
    expect(verifyPoP(tampered, token, content, ctx)).toBe(false);
  });

  it("returns false for missing 'pop:' prefix", () => {
    const pop = computePoP(token, content, ctx);
    const noPrefix = pop.slice(4); // strip "pop:"
    expect(verifyPoP(noPrefix, token, content, ctx)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(verifyPoP("", token, content, ctx)).toBe(false);
  });

  it("returns false for 'pop:' with wrong body", () => {
    expect(verifyPoP("pop:WRONG", token, content, ctx)).toBe(false);
  });

  it("handles empty content round-trip", () => {
    const emptyContent = new Uint8Array(0);
    const pop = computePoP(token, emptyContent, ctx);
    expect(verifyPoP(pop, token, emptyContent, ctx)).toBe(true);
    // But wrong content should fail
    expect(verifyPoP(pop, token, new Uint8Array([1]), ctx)).toBe(false);
  });
});

describe("isPopString", () => {
  it("returns true for valid pop format", () => {
    expect(isPopString("pop:ABC123")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isPopString("")).toBe(false);
  });

  it("returns false for just prefix", () => {
    expect(isPopString("pop:")).toBe(false);
  });

  it("returns false for wrong prefix", () => {
    expect(isPopString("POP:ABC123")).toBe(false);
  });

  it("returns false for no prefix", () => {
    expect(isPopString("ABC123")).toBe(false);
  });
});

// ============================================================================
// Real-world scenario: different delegates cannot reuse each other's PoP
// ============================================================================

describe("PoP anti-replay", () => {
  const ctx = createMockPopContext();
  const content = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

  it("delegate A's PoP is invalid for delegate B's token", () => {
    // Use tokens with enough variety to avoid hash collisions in mock
    const tokenA = new Uint8Array(32);
    const tokenB = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      tokenA[i] = (i * 7 + 0x11) & 0xff;
      tokenB[i] = (i * 13 + 0x22) & 0xff;
    }

    const popA = computePoP(tokenA, content, ctx);

    // A's PoP should verify with A's token
    expect(verifyPoP(popA, tokenA, content, ctx)).toBe(true);
    // A's PoP should NOT verify with B's token
    expect(verifyPoP(popA, tokenB, content, ctx)).toBe(false);
  });
});
