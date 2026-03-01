import type { Context, Next } from "hono";
import type { AuthContext, Env } from "../types.ts";
import type { DelegateGrantStore } from "../db/delegate-grants.ts";
import type { DelegateStore } from "@casfa/realm";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mock JWT verifier: decode payload without verification, return { sub }. */
async function mockJwtVerify(token: string): Promise<{ sub: string; client_id?: string }> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Invalid JWT");
  const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
  const obj = JSON.parse(decoded) as { sub?: string; client_id?: string };
  if (obj.sub == null) throw new Error("Missing sub");
  return { sub: obj.sub, client_id: obj.client_id };
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
  jwtVerifier?: (token: string) => Promise<{ sub: string; client_id?: string }>;
  delegateGrantStore: DelegateGrantStore;
  delegateStore: DelegateStore;
};

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  const jwtVerifier = deps.jwtVerifier ?? mockJwtVerify;

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
        const userAuth: AuthContext = { type: "user", userId };
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
    const delegate = await deps.delegateStore.getDelegate(branchId);
    if (!delegate) {
      return c.json({ error: "UNAUTHORIZED", message: "Branch not found" }, 401);
    }
    const exp =
      delegate.lifetime === "limited"
        ? delegate.expiresAt
        : delegate.accessExpiresAt;
    if (Date.now() > exp) {
      return c.json({ error: "UNAUTHORIZED", message: "Branch token expired" }, 401);
    }
    const auth: AuthContext = {
      type: "worker",
      realmId: delegate.realmId,
      branchId: delegate.delegateId,
      access: "readwrite",
    };
    c.set("auth", auth);
    return next();
  };
}
