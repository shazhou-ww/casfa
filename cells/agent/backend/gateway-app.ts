/**
 * Gateway entry: build Hono app from env when mounting under platform gateway.
 * Sets process.env then dynamically imports dev-app so loadConfig() sees gateway env.
 */
import type { Hono } from "hono";

export async function createAppForGateway(env: Record<string, string>): Promise<Hono> {
  Object.assign(process.env, env);
  const { app } = await import("./dev-app.ts");
  return app as unknown as Hono;
}
