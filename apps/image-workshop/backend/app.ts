/**
 * Image Workshop MCP over HTTP (Streamable HTTP transport).
 * Used by Lambda; stateless mode requires a new transport (and server) per request.
 */
import { Hono, type Context } from "hono";
import { createMcpServer } from "./index";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const app = new Hono();

app.all("*", async (c: Context) => {
  const req = c.req.raw;
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        error: "METHOD_NOT_ALLOWED",
        message: "SSE not supported. Use POST for JSON-RPC only.",
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

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

export type App = typeof app;
export { app };
