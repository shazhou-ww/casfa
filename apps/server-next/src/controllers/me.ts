import type { Context } from "hono";
import type { Env } from "../types.ts";

export type MeControllerDeps = Record<string, unknown>;

export function createMeController(_deps: MeControllerDeps) {
  return {
    get(c: Context<Env>): Response {
      const auth = c.get("auth");
      if (!auth || auth.type !== "user") {
        return c.json({ error: "FORBIDDEN", message: "Profile only available for user auth" }, 403);
      }
      return c.json({
        userId: auth.userId,
        email: auth.email,
        name: auth.name,
        picture: auth.picture,
      }, 200);
    },
  };
}
