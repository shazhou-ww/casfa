import type { Context, Next } from "hono";
import type { Env } from "../types.ts";

function getEffectiveRealmId(auth: NonNullable<Env["Variables"]["auth"]>): string {
  if (auth.type === "user") return auth.userId;
  return auth.realmId;
}

export function createRealmMiddleware() {
  return async function realmMiddleware(c: Context<Env>, next: Next) {
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "FORBIDDEN", message: "No auth context" }, 403);
    }
    let realmIdParam = c.req.param("realmId");
    if (realmIdParam === "me") {
      realmIdParam = getEffectiveRealmId(auth);
    }
    const effectiveRealmId = getEffectiveRealmId(auth);
    if (realmIdParam !== effectiveRealmId) {
      return c.json(
        { error: "FORBIDDEN", message: "realmId does not match auth" },
        403
      );
    }
    return next();
  };
}
