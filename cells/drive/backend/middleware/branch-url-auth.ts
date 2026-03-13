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

export function createBranchUrlAuthMiddleware(deps: BranchUrlAuthDeps) {
  return async function branchUrlAuth(c: Context<Env>, next: Next) {
    const path = c.req.path;
    if (!path.startsWith("/branch/")) {
      return next();
    }
    const parts = path.split("/").filter((s) => s.length > 0);
    // /branch/:branchId/:verification/... -> parts = ["branch", branchId, verification, ...]
    if (parts.length < 4 || parts[0] !== "branch") {
      return next();
    }
    const branchId = parts[1]!;
    const verification = parts[2]!;
    const restPath = "/" + parts.slice(3).join("/");

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
    url.pathname = restPath;
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
