import type { Context } from "hono";
import type { SettingsStore } from "../db/settings-store.ts";
import type { Env } from "../types.ts";

export type SettingsControllerDeps = {
  settingsStore: SettingsStore;
};

export function createSettingsController(deps: SettingsControllerDeps) {
  const { settingsStore } = deps;
  function resolveRealmId(c: Context<Env>): string | null {
    const fromPath = c.req.param("realmId");
    if (fromPath && fromPath.trim() !== "") return fromPath;
    const auth = c.get("auth");
    if (!auth?.userId) return null;
    return auth.userId;
  }

  return {
    async list(c: Context<Env>) {
      const realmId = resolveRealmId(c);
      if (!realmId) return c.json({ error: "UNAUTHORIZED", message: "Missing auth realm" }, 401);
      const items = await settingsStore.list(realmId);
      return c.json({ items }, 200);
    },

    async get(c: Context<Env>) {
      const realmId = resolveRealmId(c);
      if (!realmId) return c.json({ error: "UNAUTHORIZED", message: "Missing auth realm" }, 401);
      const key = c.req.param("key")!;
      const result = await settingsStore.get(realmId, key);
      if (!result) return c.json({ error: "NOT_FOUND", message: "Setting not found" }, 404);
      return c.json({ key, value: result.value, updatedAt: result.updatedAt }, 200);
    },

    async set(c: Context<Env>) {
      const realmId = resolveRealmId(c);
      if (!realmId) return c.json({ error: "UNAUTHORIZED", message: "Missing auth realm" }, 401);
      const key = c.req.param("key")!;
      let body: { value: unknown };
      try {
        body = (await c.req.json()) as { value: unknown };
      } catch {
        return c.json({ error: "VALIDATION_ERROR", message: "Invalid JSON body" }, 400);
      }
      const setting = await settingsStore.set(realmId, key, body.value);
      return c.json(setting, 200);
    },
  };
}
