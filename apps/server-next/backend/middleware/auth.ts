import type { Context, Next } from "hono";
import type { AuthContext, Env } from "../types.ts";
import type { DelegateGrantStore } from "../db/delegate-grants.ts";
import type { BranchStore } from "../db/branch-store.ts";
import type { ServerConfig } from "../config.ts";
import * as jose from "jose";
import { createCognitoJwtVerifier } from "../auth/cognito-jwks.ts";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mock JWT verifier: decode payload without verification, return { sub, client_id?, email?, name?, picture? }. */
async function mockJwtVerify(token: string): Promise<{
  sub: string;
  client_id?: string;
  email?: string;
  name?: string;
  picture?: string;
}> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Invalid JWT");
  const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
  const obj = JSON.parse(decoded) as {
    sub?: string;
    client_id?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (obj.sub == null) throw new Error("Missing sub");
  return {
    sub: obj.sub,
    client_id: obj.client_id,
    email: obj.email,
    name: obj.name,
    picture: obj.picture,
  };
}

type JwtPayload = {
  sub: string;
  client_id?: string;
  email?: string;
  name?: string;
  picture?: string;
};

/** Verify mock JWT with HS256 using MOCK_JWT_SECRET; rejects invalid or expired tokens. */
function createMockSecretJwtVerifier(secret: string): (token: string) => Promise<JwtPayload> {
  const key = new Uint8Array(new TextEncoder().encode(secret));
  return async (token: string): Promise<JwtPayload> => {
    const { payload } = await jose.jwtVerify(token, key);
    const sub = payload.sub;
    if (!sub || typeof sub !== "string") throw new Error("Missing sub");
    return {
      sub,
      client_id: typeof payload.client_id === "string" ? payload.client_id : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  };
}

/** Decode Branch token (base64url of branchId) to branchId */
function decodeBranchToken(token: string): string | null {
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export type AuthMiddlewareDeps = {
  jwtVerifier?: (token: string) => Promise<{
    sub: string;
    client_id?: string;
    email?: string;
    name?: string;
    picture?: string;
  }>;
  config?: ServerConfig;
  delegateGrantStore: DelegateGrantStore;
  branchStore: BranchStore;
};

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  let jwtVerifier = deps.jwtVerifier;
  if (jwtVerifier == null) {
    const auth = deps.config?.auth;
    if (auth?.cognitoRegion && auth?.cognitoUserPoolId) {
      jwtVerifier = createCognitoJwtVerifier({
        region: auth.cognitoRegion,
        userPoolId: auth.cognitoUserPoolId,
        clientId: auth.cognitoClientId,
      });
    } else if (auth?.mockJwtSecret) {
      jwtVerifier = createMockSecretJwtVerifier(auth.mockJwtSecret);
    } else {
      jwtVerifier = mockJwtVerify;
    }
  }

  return async function authMiddleware(c: Context<Env>, next: Next) {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization" }, 401);
    }
    const token = header.slice(7).trim();
    if (!token) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing token" }, 401);
    }

    if (token.includes(".")) {
      try {
        // MCP delegate token: format "header.payload.mcp" (no Cognito signature). Resolve by hash lookup only.
        const parts = token.split(".");
        if (parts.length === 3 && parts[2] === "mcp" && parts[1]) {
          const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
          const obj = JSON.parse(decoded) as { sub?: string };
          const realmId = obj.sub;
          if (realmId && typeof realmId === "string") {
            const tokenHash = await sha256Hex(token);
            const grant = await deps.delegateGrantStore.getByAccessTokenHash(realmId, tokenHash);
            if (grant) {
              c.set("auth", {
                type: "delegate",
                realmId: grant.realmId,
                delegateId: grant.delegateId,
                clientId: grant.clientId,
                permissions: grant.permissions,
              } satisfies AuthContext);
              return next();
            }
          }
        }

        const payload = await jwtVerifier(token);
        const userId = payload.sub;
        const tokenHash = await sha256Hex(token);
        const realmIdForLookup = userId;
        const grant = await deps.delegateGrantStore.getByAccessTokenHash(
          realmIdForLookup,
          tokenHash
        );
        if (grant) {
          const auth: AuthContext = {
            type: "delegate",
            realmId: grant.realmId,
            delegateId: grant.delegateId,
            clientId: grant.clientId,
            permissions: grant.permissions,
          };
          c.set("auth", auth);
          return next();
        }
        const userAuth: AuthContext = {
          type: "user",
          userId,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
        };
        c.set("auth", userAuth);
        return next();
      } catch {
        return c.json({ error: "UNAUTHORIZED", message: "Invalid token" }, 401);
      }
    }

    const branchId = decodeBranchToken(token);
    if (!branchId) {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid branch token" }, 401);
    }
    const branch = await deps.branchStore.getBranch(branchId);
    if (!branch) {
      return c.json({ error: "UNAUTHORIZED", message: "Branch not found" }, 401);
    }
    if (Date.now() > branch.expiresAt) {
      return c.json({ error: "UNAUTHORIZED", message: "Branch token expired" }, 401);
    }
    const auth: AuthContext = {
      type: "worker",
      realmId: branch.realmId,
      branchId: branch.branchId,
      access: "readwrite",
    };
    c.set("auth", auth);
    return next();
  };
}
