import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { formatToolValidationError } from "./validation.js";
import type { CellMcpServerOptions, ToolResult } from "./types.js";

type ToolReg = {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler: (args: unknown) => ToolResult | Promise<ToolResult>;
};

export function createCellMcpServer(options: CellMcpServerOptions) {
  const { name, version, authCheck, onUnauthorized } = options;
  const tools: ToolReg[] = [];
  const resources: unknown[] = [];
  const prompts: unknown[] = [];

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

  function getRoute(): ReturnType<typeof createRoute> {
    return createRoute();
  }

  function createRoute(): unknown {
    // Stub: Task 6 will implement Hono app + transport
    return undefined;
  }

  return { registerTool, getRoute };
}
