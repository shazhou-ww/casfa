import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Connect } from "vite";

/**
 * Find monorepo root by walking up from cellDir until we see "packages" or root package.json with workspaces.
 */
function findWorkspaceRoot(cellDir: string): string | null {
  let dir = resolve(cellDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "packages"))) return dir;
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: string[] };
        if (Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Build resolve.alias for workspace deps so Vite (root=frontend) can resolve packages from repo root.
 * Reads frontend/package.json and maps each workspace:* dependency to packages/<unscoped-name>.
 */
export function getWorkspaceAlias(frontendDir: string, cellDir: string): Record<string, string> {
  const pkgPath = resolve(frontendDir, "package.json");
  if (!existsSync(pkgPath)) return {};
  const root = findWorkspaceRoot(cellDir);
  if (!root) return {};
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...(pkg.devDependencies ?? {}) };
  const alias: Record<string, string> = {};
  for (const [name, range] of Object.entries(deps ?? {}) as [string, string][]) {
    if (range !== "workspace:*" && !range.startsWith("workspace:")) continue;
    const unscoped = name.includes("/") ? name.split("/")[1]! : name;
    const pkgDir = resolve(root, "packages", unscoped);
    if (existsSync(pkgDir)) {
      alias[name] = pkgDir;
    }
  }
  return alias;
}

/**
 * Build proxy config for dev: one proxy entry per backend route from cell.yaml.
 * Routes without a trailing "/*" are exact-matched (bypass so non-matching paths stay on frontend).
 * E.g. /oauth/callback proxies only that path; /oauth/callback-complete is not listed so stays SPA.
 */
export function buildDevProxy(
  backendEntries: Array<{ routes: string[] }> | undefined,
  target: string
): Record<
  string,
  { target: string; bypass?: (req: Connect.IncomingMessage) => string | undefined }
> {
  const proxy: Record<
    string,
    { target: string; bypass?: (req: Connect.IncomingMessage) => string | undefined }
  > = {};
  if (!backendEntries) return proxy;
  for (const entry of backendEntries) {
    for (const route of entry.routes) {
      const key = route.replace(/\/\*$/, "");
      if (!key) continue;
      const isPrefixRoute = route.endsWith("/*");
      proxy[key] = {
        target,
        ...(isPrefixRoute
          ? {}
          : {
              bypass(req) {
                const pathname = req.url?.split("?")[0] ?? "";
                if (pathname !== key) return "/index.html";
              },
            }),
      };
    }
  }
  return proxy;
}
