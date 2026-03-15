import type { Context } from "hono";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolHandlerContext = {
  auth?: unknown;
};

export type CellMcpServerOptions = {
  name: string;
  version: string;
  authCheck?: (c: Context<Record<string, unknown>>) => boolean | Promise<boolean>;
  onUnauthorized?: (c: Context<Record<string, unknown>>) => Response;
};
