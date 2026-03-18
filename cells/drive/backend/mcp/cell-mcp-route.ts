/**
 * MCP route for drive using @casfa/cell-mcp (WebStandardStreamableHTTPServerTransport).
 * Auth is provided per-request via AsyncLocalStorage so tool handlers can call executeTool(auth, deps, ...).
 */

import { createCellMcpServer } from "@casfa/cell-mcp";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";
import { z } from "zod";
import type { McpHandlerDeps } from "./handler.ts";
import { executeTool } from "./handler.ts";
import type { Env } from "../types.ts";
import skillContent from "./skills/casfa-file-management.md";

type McpContext = {
  auth: NonNullable<Env["Variables"]["auth"]>;
  deps: McpHandlerDeps;
};

const mcpStorage = new AsyncLocalStorage<McpContext>();

export function createServerNextMcpRoute(deps: McpHandlerDeps) {
  const cellMcp = createCellMcpServer({
    name: "casfa-drive-mcp",
    version: "0.1.0",
    // Auth is enforced by the returned handler before calling route.fetch(); no authCheck here.
  });

  // Zod schemas for each tool (optional fields omitted or optional())
  const branchCreate = z.object({
    mountPath: z.string(),
    ttl: z.number().optional(),
    parentBranchId: z.string().optional(),
  });
  const branchClose = z.object({
    branchId: z.string().optional(),
  });
  const branchTransferPaths = z.object({
    source: z.string(),
    target: z.string(),
    mapping: z.record(z.string(), z.string()),
    mode: z.enum(["replace", "fail_if_exists", "merge_dir"]).optional(),
  });
  const fsMkdir = z.object({ paths: z.array(z.string()).min(1), recursive: z.boolean().optional() });
  const fsLs = z.object({ paths: z.array(z.string()).min(1), mode: z.enum(["glob", "regex"]).optional() });
  const fsStat = z.object({ path: z.string() });
  const fsRead = z.object({ path: z.string() });
  const fsRm = z.object({ paths: z.array(z.string()).min(1), mode: z.enum(["glob", "regex"]).optional() });
  const fsMv = z.object({ from: z.string(), to: z.string(), mode: z.enum(["glob", "regex"]).optional() });
  const fsCp = z.object({ from: z.string(), to: z.string(), mode: z.enum(["glob", "regex"]).optional() });
  const fsBatch = z.object({
    commands: z
      .array(
        z.object({
          name: z.enum(["mv", "cp", "rm", "mkdir"]),
          arguments: z.record(z.string(), z.unknown()),
        })
      )
      .min(1),
    clientRequestId: z.string().optional(),
  });
  const fsWrite = z.object({
    path: z.string(),
    content: z.string(),
    contentType: z.string().optional(),
  });

  const tools: Array<{ name: string; description: string; schema: z.ZodType<Record<string, unknown>> }> = [
    { name: "create_branch", description: "Create a branch. Without parentBranchId creates under realm root (requires branch_manage). With parentBranchId creates sub-branch (Worker only, parent must be own branch). If mountPath does not exist, the new branch starts with a null root (no root node); use this for artist flux_image so the image becomes the branch root. Returns branchId, accessToken, expiresAt, and accessUrlPrefix (single URL for branch-scoped requests; use as casfaBranchUrl in flux_image, no token needed).", schema: branchCreate },
    { name: "close_branch", description: "Close current branch (Worker) or specified branch (user/delegate with branch_manage).", schema: branchClose },
    { name: "transfer_paths", description: "Transfer mapped paths from one branch to another branch atomically.", schema: branchTransferPaths },
    { name: "fs_mkdir", description: "Create directories. arguments: { paths: string[], recursive?: boolean }.", schema: fsMkdir },
    { name: "fs_ls", description: "List files/directories matched by { paths, mode? }. mode defaults to glob. Single-level only: glob forbids **; regex matches basename only. No-match is not an error.", schema: fsLs },
    { name: "fs_stat", description: "Get metadata (kind, size, contentType) for a file or directory.", schema: fsStat },
    { name: "fs_read", description: "Read text content of a file (single-block, ≤4MB).", schema: fsRead },
    { name: "fs_rm", description: "Remove files/directories matched by { paths, mode? }. mode defaults to glob. Single-level only. No-match is not an error. Requires file_write.", schema: fsRm },
    { name: "fs_mv", description: "Move files/directories matched by { from, to, mode? }. Supports {basename} {dirname} {ext} and {capture:n} for regex mode. Single-level only. No-match is not an error.", schema: fsMv },
    { name: "fs_cp", description: "Copy files/directories matched by { from, to, mode? }. Directory copy is recursive by default. Supports {basename} {dirname} {ext} and {capture:n} for regex mode. Single-level only. No-match is not an error.", schema: fsCp },
    { name: "fs_batch", description: "Atomic batch. commands: [{ name, arguments }], supported names: mv|cp|rm|mkdir. Success returns summary+tombstones; failed returns error only.", schema: fsBatch },
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
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization" }, 401);
    }
    // Normalize path to /mcp so cell-mcp's POST /mcp matches (cursor may POST to /mcp/sse etc.)
    const url = new URL(c.req.url);
    url.pathname = "/mcp";
    const req = new Request(url, { method: c.req.method, headers: c.req.raw.headers, body: c.req.raw.body });
    return mcpStorage.run({ auth, deps }, () => route.fetch(req));
  };
}
