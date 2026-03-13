import { describe, expect, test } from "bun:test";
import type { DelegateGrantStore } from "@casfa/cell-delegates-server";
import { createOAuthServer } from "./oauth-server.ts";

function createNoopGrantStore(overrides?: Partial<DelegateGrantStore>): DelegateGrantStore {
  return {
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async getByAccessTokenHash() {
      return null;
    },
    async getByRefreshTokenHash() {
      return null;
    },
    async insert() {},
    async remove() {},
    async updateTokens() {},
    ...overrides,
  };
}

describe("OAuthServer resolveAuth", () => {
  test("returns user auth even if grant-store lookup fails", async () => {
    const server = createOAuthServer({
      issuerUrl: "http://localhost:7100/sso",
      cognitoConfig: {
        region: "us-east-1",
        userPoolId: "us-east-1_example",
        clientId: "client",
        hostedUiUrl: "https://example.auth.us-east-1.amazoncognito.com",
      },
      jwtVerifier: async () => ({
        userId: "u1",
        email: "u1@example.com",
        name: "User One",
        rawClaims: {},
      }),
      grantStore: createNoopGrantStore({
        async getByAccessTokenHash() {
          throw new Error("dynamodb unavailable");
        },
      }),
      permissions: ["use_mcp"],
    });

    const auth = await server.resolveAuth("aaa.bbb.ccc");
    expect(auth?.type).toBe("user");
    if (auth?.type === "user") {
      expect(auth.userId).toBe("u1");
      expect(auth.email).toBe("u1@example.com");
    }
  });
});
