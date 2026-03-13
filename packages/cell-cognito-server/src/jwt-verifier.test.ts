import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  createMockJwt,
  createMockJwtVerifier,
  mapJwtPayloadToVerifiedUser,
} from "./jwt-verifier.ts";

describe("createMockJwtVerifier", () => {
  const secret = "test-secret-key-for-unit-tests";

  it("verifies a valid mock JWT", async () => {
    const token = await createMockJwt(secret, {
      sub: "user-123",
      email: "test@example.com",
      name: "Test User",
    });
    const verifier = createMockJwtVerifier(secret);
    const result = await verifier(token);
    expect(result.userId).toBe("user-123");
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("Test User");
    expect(result.rawClaims.sub).toBe("user-123");
  });

  it("rejects a token signed with wrong secret", async () => {
    const token = await createMockJwt("wrong-secret", {
      sub: "user-123",
      email: "test@example.com",
      name: "Test User",
    });
    const verifier = createMockJwtVerifier(secret);
    await expect(verifier(token)).rejects.toThrow();
  });

  it("throws if sub is missing", async () => {
    const key = new TextEncoder().encode(secret);
    const token = await new jose.SignJWT({ email: "test@example.com", name: "No Sub" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(key);
    const verifier = createMockJwtVerifier(secret);
    await expect(verifier(token)).rejects.toThrow("Missing sub");
  });

  it("falls back to sub when email/name are missing", async () => {
    const token = await createMockJwt(secret, {
      sub: "user-123",
    });
    const verifier = createMockJwtVerifier(secret);
    const result = await verifier(token);
    expect(result.userId).toBe("user-123");
    expect(result.email).toBe("user-123");
    expect(result.name).toBe("user-123");
  });
});

describe("createMockJwt", () => {
  it("creates a JWT with the given payload", async () => {
    const secret = "test-secret";
    const token = await createMockJwt(secret, {
      sub: "user-456",
      email: "a@b.com",
      name: "A B",
    });
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("mapJwtPayloadToVerifiedUser", () => {
  it("uses cognito:username as email fallback", () => {
    const mapped = mapJwtPayloadToVerifiedUser({
      sub: "user-abc",
      "cognito:username": "microsoft_xxx",
    });
    expect(mapped.email).toBe("microsoft_xxx");
    expect(mapped.name).toBe("microsoft_xxx");
  });
});
