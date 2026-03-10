/**
 * Unit tests for delegate-token-utils (v3 — simplified format)
 *
 * Tests the server-side bridge utilities that connect
 * @casfa/delegate-token v3 with Blake3 hashing.
 */

import { describe, expect, it } from "bun:test";
import { AT_SIZE, decodeToken, RT_SIZE } from "@casfa/delegate-token";
import {
  bytesToDelegateId,
  computeTokenHash,
  delegateIdToBytes,
  generateTokenPair,
} from "../../src/util/delegate-token-utils.ts";
import { generateDelegateId } from "../../src/util/token-id.ts";

// ============================================================================
// delegateIdToBytes
// ============================================================================

describe("delegateIdToBytes", () => {
  // dlt_04HMASW9NF6YY0938NKRKAYDXW encodes bytes 0x0123456789abcdef0123456789abcdef
  const testDelegateId = "dlt_04HMASW9NF6YY0938NKRKAYDXW";

  it("converts a dlt_ CB32 ID to raw 16 bytes", () => {
    const bytes = delegateIdToBytes(testDelegateId);
    expect(bytes.length).toBe(16);
    expect(bytes[0]).toBe(0x01);
    expect(bytes[1]).toBe(0x23);
    expect(bytes[2]).toBe(0x45);
    expect(bytes[3]).toBe(0x67);
    expect(bytes[4]).toBe(0x89);
    expect(bytes[5]).toBe(0xab);
    expect(bytes[6]).toBe(0xcd);
    expect(bytes[7]).toBe(0xef);
    expect(bytes[8]).toBe(0x01);
    expect(bytes[9]).toBe(0x23);
    expect(bytes[10]).toBe(0x45);
    expect(bytes[11]).toBe(0x67);
    expect(bytes[12]).toBe(0x89);
    expect(bytes[13]).toBe(0xab);
    expect(bytes[14]).toBe(0xcd);
    expect(bytes[15]).toBe(0xef);
  });

  it("throws for missing dlt_ prefix", () => {
    expect(() => delegateIdToBytes("short")).toThrow("Invalid delegate ID format");
  });

  it("throws for invalid CB32 length", () => {
    expect(() => delegateIdToBytes("dlt_SHORT")).toThrow();
  });

  it("is deterministic", () => {
    const a = delegateIdToBytes(testDelegateId);
    const b = delegateIdToBytes(testDelegateId);
    expect(a).toEqual(b);
  });
});

// ============================================================================
// bytesToDelegateId
// ============================================================================

describe("bytesToDelegateId", () => {
  it("roundtrips with delegateIdToBytes", () => {
    const testDelegateId = "dlt_04HMASW9NF6YY0938NKRKAYDXW";
    const bytes = delegateIdToBytes(testDelegateId);
    const result = bytesToDelegateId(bytes);
    expect(result).toBe(testDelegateId);
  });

  it("throws for wrong length", () => {
    expect(() => bytesToDelegateId(new Uint8Array(10))).toThrow("Expected 16 bytes");
  });

  it("roundtrips with generated delegate IDs", () => {
    const id = generateDelegateId();
    const bytes = delegateIdToBytes(id);
    const back = bytesToDelegateId(bytes);
    expect(back).toBe(id);
  });
});

// ============================================================================
// computeTokenHash
// ============================================================================

describe("computeTokenHash", () => {
  it("returns 32-char hex string", () => {
    const hash = computeTokenHash(new Uint8Array(32));
    expect(hash.length).toBe(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic", () => {
    const data = new Uint8Array([1, 2, 3]);
    const a = computeTokenHash(data);
    const b = computeTokenHash(data);
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = computeTokenHash(new Uint8Array([1, 2, 3]));
    const b = computeTokenHash(new Uint8Array([4, 5, 6]));
    expect(a).not.toBe(b);
  });
});

// ============================================================================
// generateTokenPair
// ============================================================================

describe("generateTokenPair", () => {
  const testDelegateId = generateDelegateId();

  it("generates RT + AT pair", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });

    expect(pair.refreshToken).toBeDefined();
    expect(pair.accessToken).toBeDefined();

    // RT fields
    expect(pair.refreshToken.bytes).toBeInstanceOf(Uint8Array);
    expect(pair.refreshToken.bytes.length).toBe(RT_SIZE);
    expect(pair.refreshToken.hash).toMatch(/^[0-9a-f]{32}$/);
    expect(pair.refreshToken.base64.length).toBeGreaterThan(0);

    // AT fields
    expect(pair.accessToken.bytes).toBeInstanceOf(Uint8Array);
    expect(pair.accessToken.bytes.length).toBe(AT_SIZE);
    expect(pair.accessToken.hash).toMatch(/^[0-9a-f]{32}$/);
    expect(pair.accessToken.base64.length).toBeGreaterThan(0);
    expect(pair.accessToken.expiresAt).toBeGreaterThan(Date.now());
  });

  it("RT is decodable as refresh token", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });
    const decoded = decodeToken(pair.refreshToken.bytes);
    expect(decoded.type).toBe("refresh");
  });

  it("AT is decodable as access token", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });
    const decoded = decodeToken(pair.accessToken.bytes);
    expect(decoded.type).toBe("access");
  });

  it("tokens embed the correct delegateId", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });

    const rtDecoded = decodeToken(pair.refreshToken.bytes);
    const atDecoded = decodeToken(pair.accessToken.bytes);

    const expectedBytes = delegateIdToBytes(testDelegateId);
    expect(rtDecoded.delegateId).toEqual(expectedBytes);
    expect(atDecoded.delegateId).toEqual(expectedBytes);
  });

  it("RT and AT have different hashes", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });
    expect(pair.refreshToken.hash).not.toBe(pair.accessToken.hash);
  });

  it("hash matches computeTokenHash of bytes", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });

    expect(pair.refreshToken.hash).toBe(computeTokenHash(pair.refreshToken.bytes));
    expect(pair.accessToken.hash).toBe(computeTokenHash(pair.accessToken.bytes));
  });

  it("base64 roundtrips correctly", () => {
    const pair = generateTokenPair({ delegateId: testDelegateId });

    // RT base64 roundtrip
    const rtBack = Buffer.from(pair.refreshToken.base64, "base64");
    expect(Buffer.from(pair.refreshToken.bytes).toString("base64")).toBe(pair.refreshToken.base64);
    expect(rtBack.length).toBe(RT_SIZE);

    // AT base64 roundtrip
    const atBack = Buffer.from(pair.accessToken.base64, "base64");
    expect(Buffer.from(pair.accessToken.bytes).toString("base64")).toBe(pair.accessToken.base64);
    expect(atBack.length).toBe(AT_SIZE);
  });

  it("default AT TTL is ~1 hour", () => {
    const before = Date.now();
    const pair = generateTokenPair({ delegateId: testDelegateId });
    const after = Date.now();

    const expectedMin = before + 3600_000;
    const expectedMax = after + 3600_000;
    expect(pair.accessToken.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(pair.accessToken.expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it("custom AT TTL is respected", () => {
    const before = Date.now();
    const pair = generateTokenPair({
      delegateId: testDelegateId,
      accessTokenTtlSeconds: 300, // 5 minutes
    });
    const after = Date.now();

    const expectedMin = before + 300_000;
    const expectedMax = after + 300_000;
    expect(pair.accessToken.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(pair.accessToken.expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it("each call produces unique tokens (different nonces)", () => {
    const a = generateTokenPair({ delegateId: testDelegateId });
    const b = generateTokenPair({ delegateId: testDelegateId });

    expect(a.refreshToken.hash).not.toBe(b.refreshToken.hash);
    expect(a.accessToken.hash).not.toBe(b.accessToken.hash);
  });
});
