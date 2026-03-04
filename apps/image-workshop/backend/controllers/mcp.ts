import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createMcpServer } from "../index";
import type { Auth } from "../types/auth";

function requireUseMcp(auth: Auth | null) {
  if (!auth) throw new HTTPException(401, { message: "Unauthorized" });
  if (auth.type === "user") return auth;
  if (auth.permissions.includes("use_mcp")) return auth;
  throw new HTTPException(403, { message: "Forbidden: use_mcp required" });
}

export function createMcpRoutes() {
  const routes = new Hono();

  routes.post("/mcp", async (c) => {
    requireUseMcp(c.get("auth"));

    const req = c.req.raw;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    const res = await transport.handleRequest(req);
    await mcpServer.close();
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  });

  routes.get("/mcp", (c) => {
    return c.json(
      { error: "METHOD_NOT_ALLOWED", message: "SSE not supported. Use POST for JSON-RPC only." },
      405
    );
  });

  return routes;
}
