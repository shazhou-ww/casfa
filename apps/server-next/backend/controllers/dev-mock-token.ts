import { SignJWT } from "jose";
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { ServerConfig } from "../config.ts";
import type { BranchStore } from "../db/branch-store.ts";
import type { CasFacade } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { ensureEmptyRoot } from "../services/root-resolver.ts";

export type DevMockTokenControllerDeps = {
  config: ServerConfig;
  branchStore: BranchStore;
  cas: CasFacade;
  key: KeyProvider;
};

/** Default sub for dev mock token when not overridden by env */
const DEFAULT_DEV_SUB = "dev-user";

/**
 * Creates a controller for GET/POST /api/dev/mock-token.
 * Only when config.auth.mockJwtSecret is set; otherwise handler returns 404.
 * On success, ensures realm root for the mock user (so realm exists after "login").
 */
export function createDevMockTokenController(deps: DevMockTokenControllerDeps) {
  return {
    async get(c: Context<Env>): Promise<Response> {
      const secret = deps.config.auth.mockJwtSecret;
      if (!secret) {
        return c.json({ error: "NOT_FOUND", message: "Not found" }, 404);
      }
      const sub = process.env.DEV_MOCK_TOKEN_SUB ?? DEFAULT_DEV_SUB;
      const email = process.env.DEV_MOCK_TOKEN_EMAIL;
      const name = process.env.DEV_MOCK_TOKEN_NAME;
      const payload: { sub: string; email?: string; name?: string } = { sub };
      if (email) payload.email = email;
      if (name) payload.name = name;

      const key = new Uint8Array(new TextEncoder().encode(secret));
      const token = await new SignJWT({ ...payload })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(key);

      const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
      await deps.branchStore.ensureRealmRoot(sub, emptyKey);

      return c.json({ token }, 200);
    },
  };
}
