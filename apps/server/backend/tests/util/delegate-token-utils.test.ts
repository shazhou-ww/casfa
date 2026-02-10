/**
 * Unit tests for delegate-token-utils
 *
 * Tests the server-side bridge utilities that connect
 * @casfa/delegate-token with the server's hash functions.
 */

import { describe, expect, it } from "bun:test";
import { decodeDelegateToken, isValidTokenIdFormat } from "@casfa/delegate-token";
import { blake3 } from "@noble/hashes/blake3";
import {
  computeRealmHash,
  computeScopeHash,
  delegateIdToIssuer,
  generateTokenPair,
} from "../../src/util/delegate-token-utils.ts";

// ============================================================================
// delegateIdToIssuer
// ============================================================================

describe("delegateIdToIssuer", () => {
  // dlt_04HMASW9NF6YY0938NKRKAYDXW encodes bytes 0x0123456789abcdef0123456789abcdef
  const testDelegateId = "dlt_04HMASW9NF6YY0938NKRKAYDXW";

  it("converts a dlt_ CB32 ID to a 32-byte issuer (left-padded)", () => {
    const issuer = delegateIdToIssuer(testDelegateId);

    expect(issuer.length).toBe(32);
    // First 16 bytes should be zeros (left-padding)
    for (let i = 0; i < 16; i++) {
      expect(issuer[i]).toBe(0);
    }
    // Bytes 16-31 should be the decoded CB32 bytes
    expect(issuer[16]).toBe(0x01);
    expect(issuer[17]).toBe(0x23);
    expect(issuer[18]).toBe(0x45);
    expect(issuer[19]).toBe(0x67);
    expect(issuer[20]).toBe(0x89);
    expect(issuer[21]).toBe(0xab);
    expect(issuer[22]).toBe(0xcd);
    expect(issuer[23]).toBe(0xef);
    expect(issuer[24]).toBe(0x01);
    expect(issuer[25]).toBe(0x23);
    expect(issuer[26]).toBe(0x45);
    expect(issuer[27]).toBe(0x67);
    expect(issuer[28]).toBe(0x89);
    expect(issuer[29]).toBe(0xab);
    expect(issuer[30]).toBe(0xcd);
    expect(issuer[31]).toBe(0xef);
  });

  it("throws for missing dlt_ prefix", () => {
    expect(() => delegateIdToIssuer("short")).toThrow("Invalid delegate ID format");
  });

  it("throws for invalid CB32 length", () => {
    expect(() => delegateIdToIssuer("dlt_SHORT")).toThrow();
  });

  it("is deterministic", () => {
    const a = delegateIdToIssuer(testDelegateId);
    const b = delegateIdToIssuer(testDelegateId);
    expect(a).toEqual(b);
  });
});

// ============================================================================
// computeRealmHash
// ============================================================================

describe("computeRealmHash", () => {
  it("returns 32-byte hash", () => {
    const hash = computeRealmHash("usr_user1");
    expect(hash.length).toBe(32);
  });

  it("is deterministic", () => {
    const a = computeRealmHash("usr_user1");
    const b = computeRealmHash("usr_user1");
    expect(a).toEqual(b);
  });

  it("produces different hashes for different realms", () => {
    const a = computeRealmHash("usr_alice");
    const b = computeRealmHash("usr_bob");
    expect(a).not.toEqual(b);
  });

  it("uses 'realm:' prefix for hashing", () => {
    const hash = computeRealmHash("test");
    const expected = blake3("realm:test");
    expect(hash).toEqual(expected);
  });
});

// ============================================================================
// computeScopeHash
// ============================================================================

describe("computeScopeHash", () => {
  it("returns 32-byte hash for empty scope", () => {
    const hash = computeScopeHash([]);
    expect(hash.length).toBe(32);
  });

  it("returns 32-byte hash for single root", () => {
    const hash = computeScopeHash(["abc123"]);
    expect(hash.length).toBe(32);
  });

  it("returns 32-byte hash for multiple roots", () => {
    const hash = computeScopeHash(["abc", "def", "ghi"]);
    expect(hash.length).toBe(32);
  });

  it("empty scope uses 'scope:empty'", () => {
    const hash = computeScopeHash([]);
    const expected = blake3("scope:empty");
    expect(hash).toEqual(expected);
  });

  it("single root uses 'scope:{root}'", () => {
    const hash = computeScopeHash(["myroot"]);
    const expected = blake3("scope:myroot");
    expect(hash).toEqual(expected);
  });

  it("multiple roots are sorted then joined", () => {
    const hash = computeScopeHash(["ccc", "aaa", "bbb"]);
    const expected = blake3("scope:aaa,bbb,ccc");
    expect(hash).toEqual(expected);
  });

  it("is deterministic regardless of input order", () => {
    const a = computeScopeHash(["z", "a", "m"]);
    const b = computeScopeHash(["a", "m", "z"]);
    expect(a).toEqual(b);
  });
});

// ============================================================================
// generateTokenPair
// ============================================================================

describe("generateTokenPair", () => {
  const testDelegateId = "dlt_04HMASW9NF6YY0938NKRKAYDXW";
  const realmHash = computeRealmHash("usr_test");
  const scopeHash = computeScopeHash([]);

  it("generates RT + AT pair", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });

    expect(pair.refreshToken).toBeDefined();
    expect(pair.accessToken).toBeDefined();

    // RT fields
    expect(pair.refreshToken.bytes).toBeInstanceOf(Uint8Array);
    expect(pair.refreshToken.bytes.length).toBe(128);
    expect(pair.refreshToken.id).toMatch(/^tkn_/);
    expect(pair.refreshToken.base64.length).toBeGreaterThan(0);

    // AT fields
    expect(pair.accessToken.bytes).toBeInstanceOf(Uint8Array);
    expect(pair.accessToken.bytes.length).toBe(128);
    expect(pair.accessToken.id).toMatch(/^tkn_/);
    expect(pair.accessToken.base64.length).toBeGreaterThan(0);
    expect(pair.accessToken.expiresAt).toBeGreaterThan(Date.now());
  });

  it("RT is decodable and has isRefresh flag", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: false,
    });

    const decoded = decodeDelegateToken(pair.refreshToken.bytes);
    expect(decoded.flags.isRefresh).toBe(true);
    expect(decoded.flags.canUpload).toBe(true);
    expect(decoded.flags.canManageDepot).toBe(false);
    expect(decoded.flags.depth).toBe(0);
    // RT TTL should be 0
    expect(decoded.ttl).toBe(0);
  });

  it("AT is decodable and has correct flags", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 3,
      canUpload: false,
      canManageDepot: true,
      accessTokenTtlSeconds: 1800,
    });

    const decoded = decodeDelegateToken(pair.accessToken.bytes);
    expect(decoded.flags.isRefresh).toBe(false);
    expect(decoded.flags.canUpload).toBe(false);
    expect(decoded.flags.canManageDepot).toBe(true);
    expect(decoded.flags.depth).toBe(3);
    // AT TTL should be a future timestamp
    expect(decoded.ttl).toBeGreaterThan(Date.now() - 5000);
  });

  it("RT and AT have different token IDs", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });

    expect(pair.refreshToken.id).not.toBe(pair.accessToken.id);
  });

  it("token IDs have valid format", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });

    expect(isValidTokenIdFormat(pair.refreshToken.id)).toBe(true);
    expect(isValidTokenIdFormat(pair.accessToken.id)).toBe(true);
  });

  it("base64 roundtrips correctly", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });

    // RT base64 roundtrip
    const rtDecoded = Buffer.from(pair.refreshToken.base64, "base64");
    expect(Uint8Array.from(rtDecoded)).toEqual(new Uint8Array(pair.refreshToken.bytes));

    // AT base64 roundtrip
    const atDecoded = Buffer.from(pair.accessToken.base64, "base64");
    expect(Uint8Array.from(atDecoded)).toEqual(new Uint8Array(pair.accessToken.bytes));
  });

  it("default AT TTL is ~1 hour", async () => {
    const before = Date.now();
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });
    const after = Date.now();

    // expiresAt should be ~1 hour from now
    const expectedMin = before + 3600_000;
    const expectedMax = after + 3600_000;
    expect(pair.accessToken.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(pair.accessToken.expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it("custom AT TTL is respected", async () => {
    const before = Date.now();
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
      accessTokenTtlSeconds: 300, // 5 minutes
    });
    const after = Date.now();

    const expectedMin = before + 300_000;
    const expectedMax = after + 300_000;
    expect(pair.accessToken.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(pair.accessToken.expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it("realm and scope hashes are embedded in token bytes", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });

    const decoded = decodeDelegateToken(pair.refreshToken.bytes);
    expect(decoded.realm).toEqual(realmHash);
    expect(decoded.scope).toEqual(scopeHash);
  });

  it("issuer is correctly embedded", async () => {
    const pair = await generateTokenPair({
      delegateId: testDelegateId,
      realmHash,
      scopeHash,
      depth: 0,
      canUpload: true,
      canManageDepot: true,
    });

    const decoded = decodeDelegateToken(pair.refreshToken.bytes);
    const expectedIssuer = delegateIdToIssuer(testDelegateId);
    expect(decoded.issuer).toEqual(expectedIssuer);
  });
});
