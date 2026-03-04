import type { Context, Next } from "hono";
import type { Auth, DelegateGrantStore } from "../types/auth";
import type { JwtVerifier } from "../utils/jwt";
import { decodeDelegateTokenPayload, sha256Hex } from "../utils/token";

declare module "hono" {
  interface ContextVariableMap {
    auth: Auth | null;
  }
}

export type AuthMiddlewareDeps = {
  jwtVerifier: JwtVerifier;
  grantStore: DelegateGrantStore;
};

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      c.set("auth", null);
      return next();
    }

    const token = header.slice(7);
    const parts = token.split(".");
    const hash = await sha256Hex(token);

    if (parts.length >= 3) {
      try {
        const jwt = await deps.jwtVerifier(token);
        const grant = await deps.grantStore.getByAccessTokenHash(jwt.sub, hash);
        if (grant) {
          c.set("auth", {
            type: "delegate",
            userId: jwt.sub,
            delegateId: grant.delegateId,
            permissions: grant.permissions,
          });
        } else {
          c.set("auth", { type: "user", userId: jwt.sub });
        }
      } catch {
        c.set("auth", null);
      }
    } else if (parts.length === 2) {
      const payload = decodeDelegateTokenPayload(token);
      if (!payload) {
        c.set("auth", null);
        return next();
      }
      const grant = await deps.grantStore.getByAccessTokenHash(payload.sub, hash);
      if (grant) {
        c.set("auth", {
          type: "delegate",
          userId: payload.sub,
          delegateId: grant.delegateId,
          permissions: grant.permissions,
        });
      } else {
        c.set("auth", null);
      }
    } else {
      c.set("auth", null);
    }

    return next();
  };
}
