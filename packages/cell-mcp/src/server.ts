import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import type { z } from "zod";
import { formatToolValidationError } from "./validation.js";
import type { CellMcpServerOptions, ToolResult } from "./types.js";

type ToolReg = {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler: (args: unknown) => ToolResult | Promise<ToolResult>;
};

// Passthrough: store args for server.registerResource / server.registerPrompt (SDK types are strict; we pass through)
type ResourceReg = Parameters<McpServer["registerResource"]>;
type PromptReg = Parameters<McpServer["registerPrompt"]>;

export function createCellMcpServer(options: CellMcpServerOptions) {
  const { name, version, authCheck, onUnauthorized } = options;
  const tools: ToolReg[] = [];
  const resources: ResourceReg[] = [];
  const prompts: PromptReg[] = [];

  function buildMcpServer(): McpServer {
    const server = new McpServer({ name, version }, {});

    for (const t of tools) {
      const wrapper = async (rawArgs: unknown): Promise<ToolResult> => {
        const parsed = t.inputSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return {
            content: [
              { type: "text" as const, text: formatToolValidationError(t.name, parsed.error) },
            ],
            isError: true,
          };
        }
        try {
          return await t.handler(parsed.data);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      };
      server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, wrapper);
    }

    for (const args of resources) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK overloads; passthrough from registerResource
      (server.registerResource as (...a: any[]) => unknown)(...args);
    }
    for (const args of prompts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK overloads; passthrough from registerPrompt
      (server.registerPrompt as (...a: any[]) => unknown)(...args);
    }

    return server;
  }

  function registerTool<T>(
    toolName: string,
    spec: { description: string; inputSchema: z.ZodType<T> },
    handler: (args: T) => ToolResult | Promise<ToolResult>
  ): void {
    tools.push({
      name: toolName,
      description: spec.description,
      inputSchema: spec.inputSchema as z.ZodType<unknown>,
      handler: handler as (args: unknown) => ToolResult | Promise<ToolResult>,
    });
  }

  function registerResource(
    ...args: ResourceReg
  ): void {
    resources.push(args);
  }

  function registerPrompt(...args: PromptReg): void {
    prompts.push(args);
  }

  function getRoute(): Hono<Record<string, unknown>> {
    return createRoute();
  }

  function createRoute(): Hono<Record<string, unknown>> {
    const app = new Hono<Record<string, unknown>>();

    app.post("/mcp", async (c) => {
      if (authCheck) {
        const ok = await authCheck(c);
        if (!ok) {
          return onUnauthorized ? onUnauthorized(c) : c.json({ error: "Unauthorized" }, 401);
        }
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = buildMcpServer();
      await server.connect(transport);
      const res = await transport.handleRequest(c.req.raw);
      await server.close();
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    });

    return app;
  }

  return { registerTool, registerResource, registerPrompt, getRoute };
}
