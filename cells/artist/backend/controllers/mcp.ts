import type { Auth } from "@casfa/cell-cognito-server";
import { Hono } from "hono";
import { createArtistMcpRoute } from "../index";

function authCheck(c: { get: (key: string) => Auth | null | undefined }): boolean {
  const auth = c.get("auth");
  if (!auth) return false;
  if (auth.type === "user") return true;
  return auth.permissions.includes("use_mcp");
}

function onUnauthorized(c: { get: (key: string) => Auth | null | undefined; json: (body: unknown, status: number) => Response }): Response {
  const auth = c.get("auth");
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ error: "Forbidden", message: "use_mcp required" }, 403);
}

export function createMcpRoutes() {
  const routes = new Hono();

  const mcpRoute = createArtistMcpRoute({ authCheck, onUnauthorized });
  routes.route("/", mcpRoute);

  routes.get("/mcp", (c) => {
    return c.json(
      { error: "METHOD_NOT_ALLOWED", message: "SSE not supported. Use POST for JSON-RPC only." },
      405
    );
  });

  return routes;
}
