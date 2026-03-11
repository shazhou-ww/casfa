/**
 * MCP route for server-next using @casfa/cell-mcp (WebStandardStreamableHTTPServerTransport).
 * Auth is provided per-request via AsyncLocalStorage so tool handlers can call executeTool(auth, deps, ...).
 */

import { createCellMcpServer } from "@casfa/cell-mcp";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";
import { z } from "zod";
import type { McpHandlerDeps } from "./handler.ts";
import { executeTool } from "./handler.ts";
import type { Env } from "../types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillContent = readFileSync(
  resolve(__dirname, "skills", "casfa-file-management.md"),
  "utf-8"
);

type McpContext = {
  auth: NonNullable<Env["Variables"]["auth"]>;
  deps: McpHandlerDeps;
};

const mcpStorage = new AsyncLocalStorage<McpContext>();

export function createServerNextMcpRoute(deps: McpHandlerDeps) {
  const cellMcp = createCellMcpServer({
    name: "casfa-server-next-mcp",
    version: "0.1.0",
    // Auth is enforced by the returned handler before calling route.fetch(); no authCheck here.
  });

  // Zod schemas for each tool (optional fields omitted or optional())
  const branchesList = z.object({});
  const branchCreate = z.object({
    mountPath: z.string(),
    ttl: z.number().optional(),
    parentBranchId: z.string().optional(),
  });
  const branchComplete = z.object({});
  const fsMkdir = z.object({ path: z.string() });
  const fsLs = z.object({ path: z.string().optional() });
  const fsStat = z.object({ path: z.string() });
  const fsRead = z.object({ path: z.string() });
  const fsRm = z.object({ path: z.string() });
  const fsMv = z.object({ from: z.string(), to: z.string() });
  const fsCp = z.object({ from: z.string(), to: z.string() });
  const fsWrite = z.object({
    path: z.string(),
    content: z.string(),
    contentType: z.string().optional(),
  });

  const tools: Array<{ name: string; description: string; schema: z.ZodType<Record<string, unknown>> }> = [
    { name: "branches_list", description: "List branches in the realm. For Worker auth returns only the current branch.", schema: branchesList },
    { name: "branch_create", description: "Create a branch. Without parentBranchId creates under realm root (requires branch_manage). With parentBranchId creates sub-branch (Worker only, parent must be own branch). If mountPath does not exist, the new branch starts with a null root (no root node); use this for image-workshop flux_image so the image becomes the branch root. Returns branchId, accessToken, expiresAt, and accessUrlPrefix (single URL for branch-scoped requests; use as casfaBranchUrl in flux_image, no token needed).", schema: branchCreate },
    { name: "branch_complete", description: "Complete the current branch (Worker only): merge into parent and invalidate this branch.", schema: branchComplete },
    { name: "fs_mkdir", description: "Create a directory at the given path. Parent path must exist. Required for creating a path before branch_create (e.g. create 'images' then create branch with mountPath 'images').", schema: fsMkdir },
    { name: "fs_ls", description: "List direct children of a directory at the given path.", schema: fsLs },
    { name: "fs_stat", description: "Get metadata (kind, size, contentType) for a file or directory.", schema: fsStat },
    { name: "fs_read", description: "Read text content of a file (single-block, ≤4MB).", schema: fsRead },
    { name: "fs_rm", description: "Remove a file or directory at the given path. Requires file_write.", schema: fsRm },
    { name: "fs_mv", description: "Move or rename a file or directory. Requires file_write.", schema: fsMv },
    { name: "fs_cp", description: "Copy a file or directory to a new path. Requires file_write.", schema: fsCp },
    { name: "fs_write", description: "Write a text file at the given path (UTF-8). Creates or overwrites. Single file ≤4MB. Text content only.", schema: fsWrite },
  ];

  for (const t of tools) {
    cellMcp.registerTool(t.name, { description: t.description, inputSchema: t.schema }, (args) => {
      const ctx = mcpStorage.getStore();
      if (!ctx) return { content: [{ type: "text" as const, text: "No auth context" }], isError: true };
      return executeTool(ctx.auth, ctx.deps, t.name, args as Record<string, unknown>);
    });
  }

  cellMcp.registerResource(
    "Casfa File Management",
    "skill://casfa-file-management",
    { description: "Skill definition for branch-based file management", mimeType: "text/markdown" },
    () => ({ contents: [{ uri: "skill://casfa-file-management", mimeType: "text/markdown", text: skillContent }] })
  );

  const route = cellMcp.getRoute();

  return async (c: Context<Env>) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    // Normalize path to /mcp so cell-mcp's POST /mcp matches (cursor may POST to /mcp/sse etc.)
    const url = new URL(c.req.url);
    url.pathname = "/mcp";
    const req = new Request(url, { method: c.req.method, headers: c.req.raw.headers, body: c.req.raw.body });
    return mcpStorage.run({ auth, deps }, () => route.fetch(req));
  };
}
