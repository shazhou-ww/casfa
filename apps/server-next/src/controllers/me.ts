import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { UserSettingsStore } from "../db/user-settings.ts";

export type MeControllerDeps = {
  userSettingsStore: UserSettingsStore;
};

export function createMeController(deps: MeControllerDeps) {
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

    async getSettings(c: Context<Env>): Promise<Response> {
      const auth = c.get("auth");
      if (!auth || auth.type !== "user") {
        return c.json({ error: "FORBIDDEN", message: "Settings only available for user auth" }, 403);
      }
      const settings = await deps.userSettingsStore.get(auth.userId);
      return c.json(settings, 200);
    },
  };
}
