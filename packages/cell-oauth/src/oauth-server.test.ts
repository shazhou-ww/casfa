import { beforeEach, describe, expect, it } from "bun:test";
import type { CognitoConfig, JwtVerifier } from "@casfa/cell-cognito";
import { createOAuthServer } from "./oauth-server.ts";
import type { DelegateGrant, DelegateGrantStore } from "./types.ts";

function createMemoryGrantStore(): DelegateGrantStore {
  const grants = new Map<string, DelegateGrant>();
  return {
    async list(userId) {
      return [...grants.values()].filter((g) => g.userId === userId);
    },
    async get(delegateId) {
      return grants.get(delegateId) ?? null;
    },
    async getByAccessTokenHash(userId, hash) {
      return (
        [...grants.values()].find((g) => g.userId === userId && g.accessTokenHash === hash) ?? null
      );
    },
    async getByRefreshTokenHash(userId, hash) {
      return (
        [...grants.values()].find((g) => g.userId === userId && g.refreshTokenHash === hash) ?? null
      );
    },
    async insert(grant) {
      grants.set(grant.delegateId, grant);
    },
    async remove(delegateId) {
      grants.delete(delegateId);
    },
    async updateTokens(delegateId, update) {
      const g = grants.get(delegateId);
      if (!g) throw new Error("not found");
      g.accessTokenHash = update.accessTokenHash;
      g.refreshTokenHash = update.refreshTokenHash;
    },
  };
}

const mockCognitoConfig: CognitoConfig = {
  region: "us-east-1",
  userPoolId: "us-east-1_test",
  clientId: "test-client",
  hostedUiUrl: "https://test.auth.us-east-1.amazoncognito.com",
};

const mockJwtVerifier: JwtVerifier = async (token: string) => {
  const parts = token.split(".");
  if (parts.length < 3) throw new Error("Not a JWT");
  const payload = JSON.parse(atob(parts[1]!));
  return {
    userId: payload.sub,
    email: payload.email ?? "test@test.com",
    name: payload.name ?? "Test",
    rawClaims: payload,
  };
};

describe("createOAuthServer", () => {
  let grantStore: DelegateGrantStore;

  beforeEach(() => {
    grantStore = createMemoryGrantStore();
  });

  function createServer() {
    return createOAuthServer({
      issuerUrl: "https://example.com",
      cognitoConfig: mockCognitoConfig,
      jwtVerifier: mockJwtVerifier,
      grantStore,
      permissions: ["use_mcp", "manage_delegates"],
    });
  }

  describe("getMetadata", () => {
    it("returns correct OAuth metadata", () => {
      const server = createServer();
      const meta = server.getMetadata();
      expect(meta.issuer).toBe("https://example.com");
      expect(meta.authorization_endpoint).toBe("https://example.com/oauth/authorize");
      expect(meta.token_endpoint).toBe("https://example.com/oauth/token");
      expect(meta.registration_endpoint).toBe("https://example.com/oauth/register");
      expect(meta.code_challenge_methods_supported).toContain("S256");
    });
  });

  describe("registerClient", () => {
    it("registers a client and returns client_id", () => {
      const server = createServer();
      const client = server.registerClient({
        clientName: "My App",
        redirectUris: ["https://app.com/callback"],
      });
      expect(client.clientId).toBeTruthy();
      expect(client.clientName).toBe("My App");
      expect(client.redirectUris).toEqual(["https://app.com/callback"]);
    });
  });

  describe("delegate CRUD", () => {
    it("creates, lists, and revokes delegates", async () => {
      const server = createServer();
      const result = await server.createDelegate({
        userId: "user-1",
        clientName: "Test Client",
        permissions: ["use_mcp"],
      });
      expect(result.grant.delegateId).toMatch(/^dlg_/);
      expect(result.grant.userId).toBe("user-1");
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();

      const list = await server.listDelegates("user-1");
      expect(list).toHaveLength(1);
      expect(list[0]!.delegateId).toBe(result.grant.delegateId);

      await server.revokeDelegate(result.grant.delegateId);
      const listAfter = await server.listDelegates("user-1");
      expect(listAfter).toHaveLength(0);
    });
  });

  describe("resolveAuth", () => {
    it("resolves a delegate access token", async () => {
      const server = createServer();
      const { accessToken } = await server.createDelegate({
        userId: "user-1",
        clientName: "Test",
        permissions: ["use_mcp"],
      });
      const auth = await server.resolveAuth(accessToken);
      expect(auth).not.toBeNull();
      expect(auth!.type).toBe("delegate");
      if (auth!.type === "delegate") {
        expect(auth!.userId).toBe("user-1");
        expect(auth!.permissions).toContain("use_mcp");
      }
    });

    it("returns null for unknown token", async () => {
      const server = createServer();
      const auth = await server.resolveAuth("random-invalid-token");
      expect(auth).toBeNull();
    });
  });
});
