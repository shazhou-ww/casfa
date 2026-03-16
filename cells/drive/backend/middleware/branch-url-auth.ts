/**
 * Middleware: /branch/:branchId/:verification/* -> validate and forward with X-Branch-Auth.
 * Only runs when path starts with /branch/; forwards to same app with path rewritten and header set.
 */
import type { Context, Next } from "hono";
import type { Hono } from "hono";
import type { BranchStore } from "../db/branch-store.ts";
import type { Env } from "../types.ts";

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type BranchUrlAuthDeps = {
  branchStore: BranchStore;
  app: Hono<Env>;
};

function normalizeBranchScopedPath(path: string): string {
  if (path.startsWith("/api/realm/")) {
    return path;
  }
  if (path === "/files" || path.startsWith("/files/")) {
    return `/api/realm/me${path}`;
  }
  if (path === "/root") {
    return "/api/realm/me/root";
  }
  if (path === "/branches" || path.startsWith("/branches/")) {
    return `/api/realm/me${path}`;
  }
  return path;
}

export function createBranchUrlAuthMiddleware(deps: BranchUrlAuthDeps) {
  return async function branchUrlAuth(c: Context<Env>, next: Next) {
    const path = c.req.path;
    const parts = path.split("/").filter((s) => s.length > 0);
    // Supports both:
    // - /branch/:branchId/:verification/...
    // - /<mount>/branch/:branchId/:verification/...
    const branchIndex = parts.indexOf("branch");
    if (branchIndex < 0) {
      return next();
    }
    if (parts.length < branchIndex + 4) {
      return next();
    }
    const branchId = parts[branchIndex + 1]!;
    const verification = parts[branchIndex + 2]!;
    const restPath = "/" + parts.slice(branchIndex + 3).join("/");
    const normalizedPath = normalizeBranchScopedPath(restPath);

    const branch = await deps.branchStore.getBranch(branchId);
    if (
      !branch?.accessVerification ||
      branch.accessVerification.value !== verification ||
      Date.now() > branch.accessVerification.expiresAt
    ) {
      return c.json(
        { error: "UNAUTHORIZED", message: "Invalid or expired branch access" },
        401
      );
    }

    const url = new URL(c.req.url);
    url.pathname = normalizedPath;
    const newHeaders = new Headers(c.req.raw.headers);
    newHeaders.set("X-Branch-Auth", base64urlEncode(branchId));

    const newReq = new Request(url.toString(), {
      method: c.req.method,
      headers: newHeaders,
      body: c.req.raw.body,
    });
    return deps.app.fetch(newReq);
  };
}
