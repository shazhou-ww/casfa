import type { Context } from "hono";
import type { UserSettingsStore } from "../db/user-settings.ts";
import type { Env } from "../types.ts";

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
      return c.json(
        {
          userId: auth.userId,
          email: auth.email,
          name: auth.name,
          picture: auth.picture,
        },
        200
      );
    },

    async getSettings(c: Context<Env>): Promise<Response> {
      const auth = c.get("auth");
      if (!auth || auth.type !== "user") {
        return c.json(
          { error: "FORBIDDEN", message: "Settings only available for user auth" },
          403
        );
      }
      const settings = await deps.userSettingsStore.get(auth.userId);
      return c.json(settings, 200);
    },

    async patchSettings(c: Context<Env>): Promise<Response> {
      const auth = c.get("auth");
      if (!auth || auth.type !== "user") {
        return c.json(
          { error: "FORBIDDEN", message: "Settings only available for user auth" },
          403
        );
      }
      let body: Record<string, unknown>;
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        return c.json({ error: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
      }
      const filtered: { language?: string; notifications?: boolean } = {};
      if (typeof body.language === "string") filtered.language = body.language;
      if (typeof body.notifications === "boolean") filtered.notifications = body.notifications;
      await deps.userSettingsStore.set(auth.userId, filtered);
      const settings = await deps.userSettingsStore.get(auth.userId);
      return c.json(settings, 200);
    },
  };
}
