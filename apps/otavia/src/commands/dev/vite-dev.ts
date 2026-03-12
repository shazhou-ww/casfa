import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadOtaviaYaml } from "../../config/load-otavia-yaml.js";
import { loadCellConfig } from "../../config/load-cell-yaml.js";
import type { CellConfig } from "../../config/cell-yaml-schema.js";
import { resolveCellDir } from "../../config/resolve-cell-dir.js";

export interface ViteDevHandle {
  stop: () => void;
}

export type RouteMatch = "prefix" | "exact";

export type RouteRule = {
  path: string;
  match: RouteMatch;
};

export type ProxyRule = {
  mount: string;
  path: string;
  match: RouteMatch;
  target: string;
};

export type MainDevGeneratedConfig = {
  firstMount: string;
  mounts: string[];
  routeRules: RouteRule[];
  proxyRules: ProxyRule[];
  frontendModuleProxyRules: Array<{
    path: string;
    sourcePath: string;
  }>;
  frontendRouteRules: Array<{
    mount: string;
    path: string;
    match: RouteMatch;
    entryName: string;
    entryType: "html" | "module";
  }>;
};

const MAIN_FRONTEND_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Casfa Main</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_FRONTEND_ENTRY_TS = `import { firstMount, mountLoaders, mounts } from "./generated/mount-loaders";

function normalizePathname(pathname: string): string {
  if (!pathname.endsWith("/")) return pathname + "/";
  return pathname;
}

function resolveMount(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return mounts.includes(seg) ? seg : null;
}

async function boot(): Promise<void> {
  const mount = resolveMount(window.location.pathname);
  if (!mount) {
    window.location.replace(\`/\${firstMount}/\`);
    return;
  }
  const desiredPrefix = \`/\${mount}/\`;
  if (!normalizePathname(window.location.pathname).startsWith(desiredPrefix)) {
    window.location.replace(desiredPrefix);
    return;
  }
  const load = mountLoaders[mount];
  if (!load) {
    window.location.replace(\`/\${firstMount}/\`);
    return;
  }
  await load();
}

void boot();
`;

const MAIN_FRONTEND_VITE_CONFIG_TS = `import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

type RouteMatch = "prefix" | "exact";
type RouteRule = { path: string; match: RouteMatch };
type ProxyRule = { mount: string; path: string; match: RouteMatch; target: string };
type FrontendModuleProxyRule = { path: string; sourcePath: string };
type MainDevGeneratedConfig = {
  firstMount: string;
  mounts: string[];
  routeRules: RouteRule[];
  proxyRules: ProxyRule[];
  frontendModuleProxyRules: FrontendModuleProxyRule[];
};

const backendPort = process.env.GATEWAY_BACKEND_PORT ?? "8900";
const vitePort = parseInt(process.env.VITE_PORT ?? "7100", 10);
const backendTarget = \`http://localhost:\${backendPort}\`;
const generatedConfigPath = new URL("./src/generated/main-dev-config.json", import.meta.url);
const packageRoot = process.env.OTAVIA_MAIN_ROOT ?? process.cwd();

function isRouteMatch(v: unknown): v is RouteMatch {
  return v === "prefix" || v === "exact";
}

function isRouteRule(v: unknown): v is RouteRule {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as RouteRule).path === "string" &&
    isRouteMatch((v as RouteRule).match)
  );
}

function isProxyRule(v: unknown): v is ProxyRule {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ProxyRule).mount === "string" &&
    typeof (v as ProxyRule).path === "string" &&
    isRouteMatch((v as ProxyRule).match) &&
    typeof (v as ProxyRule).target === "string"
  );
}

function isFrontendModuleProxyRule(v: unknown): v is FrontendModuleProxyRule {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as FrontendModuleProxyRule).path === "string" &&
    typeof (v as FrontendModuleProxyRule).sourcePath === "string"
  );
}

function loadGeneratedConfig(): MainDevGeneratedConfig | null {
  if (!existsSync(generatedConfigPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(generatedConfigPath, "utf-8")) as Partial<MainDevGeneratedConfig>;
    if (
      !Array.isArray(parsed.mounts) ||
      !Array.isArray(parsed.routeRules) ||
      !Array.isArray(parsed.proxyRules)
    ) {
      return null;
    }
    const mounts = parsed.mounts.filter((m): m is string => typeof m === "string");
    const routeRules = parsed.routeRules.filter(isRouteRule);
    const proxyRules = parsed.proxyRules.filter(isProxyRule);
    const frontendModuleProxyRules = Array.isArray(parsed.frontendModuleProxyRules)
      ? parsed.frontendModuleProxyRules.filter(isFrontendModuleProxyRule)
      : [];
    const firstMount = typeof parsed.firstMount === "string" ? parsed.firstMount : mounts[0] ?? "";
    return { firstMount, mounts, routeRules, proxyRules, frontendModuleProxyRules };
  } catch {
    return null;
  }
}

const generated = loadGeneratedConfig();
const mounts: string[] =
  generated?.mounts ??
  (() => {
    try {
      const parsed = JSON.parse(process.env.OTAVIA_MOUNTS ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
    } catch {
      return [];
    }
  })();
const mountSet = new Set(mounts);
const firstMount = generated?.firstMount ?? mounts[0] ?? "";
const routeRules: RouteRule[] =
  generated?.routeRules ??
  ["/api", "/oauth", "/.well-known", "/mcp"].map((path) => ({ path, match: "prefix" as const }));
const frontendModuleProxyRules = generated?.frontendModuleProxyRules ?? [];
const frontendModuleProxyMap = new Map(frontendModuleProxyRules.map((r) => [r.path, r.sourcePath]));

function toAbsoluteFsPath(sourcePath: string): string {
  const isWindowsAbs = /^[A-Za-z]:[\\\\/]/.test(sourcePath);
  const absolute = sourcePath.startsWith("/") || isWindowsAbs
    ? sourcePath
    : resolvePath(packageRoot, sourcePath);
  return absolute.replace(/\\\\/g, "/");
}

function extractMountFromPath(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return mountSet.has(seg) ? seg : null;
}

function matchesRule(pathname: string, rule: RouteRule): boolean {
  return rule.match === "exact"
    ? pathname === rule.path
    : pathname === rule.path || pathname.startsWith(rule.path + "/");
}

function isBackendRoute(pathname: string): boolean {
  return routeRules.some((r) => matchesRule(pathname, r));
}

function mountAwareApiRewritePlugin(): Plugin {
  return {
    name: "otavia-mount-aware-api-rewrite",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const parsed = new URL(url, "http://localhost");
        const pathname = parsed.pathname;
        const moduleSourcePath = frontendModuleProxyMap.get(pathname);
        if (moduleSourcePath) {
          req.url = \`/@fs/\${toAbsoluteFsPath(moduleSourcePath)}\${parsed.search}\`;
          next();
          return;
        }

        const alreadyMounted = extractMountFromPath(pathname);
        if (alreadyMounted) {
          next();
          return;
        }
        if (!isBackendRoute(pathname)) {
          next();
          return;
        }

        const referer = req.headers.referer;
        let mount = firstMount;
        if (referer) {
          try {
            const refPath = new URL(referer).pathname;
            const refMount = extractMountFromPath(refPath);
            if (refMount) mount = refMount;
          } catch {
            // Ignore malformed referer.
          }
        }
        if (mount) {
          req.url = \`/\${mount}\${pathname}\${parsed.search}\`;
        }
        next();
      });
    },
  };
}

const proxy: Record<string, object> = {};
const proxyRules: ProxyRule[] =
  generated?.proxyRules ??
  mounts.flatMap((mount) =>
    ["/api", "/oauth", "/.well-known", "/mcp"].map((path) => ({
      mount,
      path: \`/\${mount}\${path}\`,
      match: "prefix" as const,
      target: backendTarget,
    }))
  );
const sortedProxyRules = proxyRules.slice().sort((a, b) => {
  if (a.path === b.path) {
    if (a.match === b.match) return 0;
    return a.match === "exact" ? -1 : 1;
  }
  return b.path.length - a.path.length;
});
for (const rule of sortedProxyRules) {
  if (proxy[rule.path]) continue;
  if (rule.match === "exact") {
    proxy[rule.path] = {
      target: rule.target,
      bypass(req: { url?: string }) {
        const pathname = req.url?.split("?")[0] ?? "";
        if (pathname !== rule.path) return "/index.html";
      },
    };
  } else {
    proxy[rule.path] = { target: rule.target };
  }
}

export default defineConfig({
  plugins: [mountAwareApiRewritePlugin(), react()],
  resolve: { conditions: ["bun"], dedupe: ["react", "react-dom"] },
  server: {
    port: vitePort,
    host: "0.0.0.0",
    strictPort: true,
    proxy,
  },
});
`;

function writeMainFrontendShell(frontendRoot: string): void {
  const srcDir = resolve(frontendRoot, "src");
  const generatedDir = resolve(srcDir, "generated");
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(resolve(frontendRoot, "index.html"), MAIN_FRONTEND_INDEX_HTML, "utf-8");
  writeFileSync(resolve(frontendRoot, "vite.config.ts"), MAIN_FRONTEND_VITE_CONFIG_TS, "utf-8");
  writeFileSync(resolve(srcDir, "main.ts"), MAIN_FRONTEND_ENTRY_TS, "utf-8");
}

function normalizeRoutePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`Invalid backend route "${path}": route must start with "/"`);
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
}

export function deriveRouteRulesFromCellConfig(config: CellConfig): RouteRule[] {
  const seen = new Set<string>();
  const rules: RouteRule[] = [];
  const entries = config.backend?.entries ? Object.values(config.backend.entries) : [];
  for (const entry of entries) {
    for (const route of entry.routes ?? []) {
      const isPrefix = route.endsWith("/*");
      const rawPath = isPrefix ? route.slice(0, -2) : route;
      const path = normalizeRoutePath(rawPath);
      const match: RouteMatch = isPrefix ? "prefix" : "exact";
      const key = `${path}|${match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ path, match });
    }
  }
  return rules;
}

export function buildMainDevGeneratedConfig(
  cells: Array<{
    mount: string;
    routeRules: RouteRule[];
    moduleProxySpecs: FrontendModuleProxySpec[];
    frontendRouteRules: Array<{
      mount: string;
      path: string;
      match: RouteMatch;
      entryName: string;
      entryType: "html" | "module";
    }>;
  }>,
  backendPort: number,
  sourcePathBaseDir?: string
): MainDevGeneratedConfig {
  const mounts = cells.map((c) => c.mount);
  const firstMount = mounts[0] ?? "";
  const routeRulesMap = new Map<string, RouteRule>();
  const proxyRules: ProxyRule[] = [];
  const frontendModuleProxyRules: MainDevGeneratedConfig["frontendModuleProxyRules"] = [];
  const frontendRouteRules: MainDevGeneratedConfig["frontendRouteRules"] = [];
  const target = `http://localhost:${backendPort}`;

  for (const cell of cells) {
    frontendModuleProxyRules.push(
      ...cell.moduleProxySpecs.map((spec) => ({
        path: spec.routePath,
        sourcePath: sourcePathBaseDir
          ? relative(sourcePathBaseDir, spec.sourcePath).replace(/\\/g, "/")
          : spec.sourcePath,
      }))
    );
    frontendRouteRules.push(...cell.frontendRouteRules);
    for (const rule of cell.routeRules) {
      const rrKey = `${rule.path}|${rule.match}`;
      if (!routeRulesMap.has(rrKey)) routeRulesMap.set(rrKey, rule);
      const mountedPath = rule.path === "/" ? `/${cell.mount}` : `/${cell.mount}${rule.path}`;
      proxyRules.push({
        mount: cell.mount,
        path: mountedPath,
        match: rule.match,
        target,
      });
    }
  }

  proxyRules.sort((a, b) => {
    if (a.path === b.path) {
      if (a.match === b.match) return a.mount.localeCompare(b.mount);
      return a.match === "exact" ? -1 : 1;
    }
    return b.path.length - a.path.length;
  });

  return {
    firstMount,
    mounts,
    routeRules: Array.from(routeRulesMap.values()),
    proxyRules,
    frontendModuleProxyRules,
    frontendRouteRules,
  };
}

function normalizeFrontendRoutePath(path: string): string {
  if (path === "") return "/";
  if (!path.startsWith("/")) {
    throw new Error(`Invalid frontend route "${path}": route must start with "/"`);
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
}

function toMountedPath(mount: string, routePath: string): string {
  const normalizedRoute = normalizeFrontendRoutePath(routePath);
  return normalizedRoute === "/" ? `/${mount}` : `/${mount}${normalizedRoute}`;
}

function isHtmlEntry(entry: string): boolean {
  return entry.toLowerCase().endsWith(".html");
}

export function deriveFrontendRouteRulesFromCellConfig(
  mount: string,
  config: CellConfig
): MainDevGeneratedConfig["frontendRouteRules"] {
  const entries = config.frontend?.entries ? Object.entries(config.frontend.entries) : [];
  const rules: MainDevGeneratedConfig["frontendRouteRules"] = [];
  for (const [entryName, entry] of entries) {
    const entryType: "html" | "module" = isHtmlEntry(entry.entry) ? "html" : "module";
    for (const route of entry.routes ?? []) {
      const isPrefix = route.endsWith("/*");
      const rawPath = isPrefix ? route.slice(0, -2) : route;
      const path = toMountedPath(mount, rawPath);
      rules.push({
        mount,
        path,
        match: isPrefix ? "prefix" : "exact",
        entryName,
        entryType,
      });
    }
  }
  return rules;
}

type FrontendModuleProxySpec = {
  mount: string;
  routePath: string;
  sourcePath: string;
};

export function deriveFrontendModuleProxySpecs(
  mount: string,
  cellDir: string,
  config: CellConfig
): FrontendModuleProxySpec[] {
  if (!config.frontend) return [];
  const specs: FrontendModuleProxySpec[] = [];
  for (const entry of Object.values(config.frontend.entries)) {
    if (isHtmlEntry(entry.entry)) continue;
    const sourcePath = resolve(cellDir, config.frontend.dir, entry.entry).replace(/\\/g, "/");
    for (const route of entry.routes ?? []) {
      if (route.endsWith("/*")) {
        throw new Error(
          `Invalid module frontend route "${route}" for mount "${mount}": wildcard routes are only supported for HTML entries`
        );
      }
      specs.push({
        mount,
        routePath: toMountedPath(mount, route),
        sourcePath,
      });
    }
  }
  return specs;
}

/**
 * Start main frontend Vite dev server (single root MPA shell):
 * - root is apps/main/.otavia/dev/main-frontend
 * - dynamically loads each cell frontend via package exports ("@pkg/frontend")
 * - proxies API/OAuth requests to backend gateway with mount-aware rewrite
 * If no cell has frontend, returns a no-op stop.
 */
export async function startViteDev(
  rootDir: string,
  backendPort: number,
  vitePort: number
): Promise<ViteDevHandle> {
  const root = resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const cellsWithFrontend: {
    mount: string;
    packageName: string;
    routeRules: RouteRule[];
    frontendRouteRules: MainDevGeneratedConfig["frontendRouteRules"];
    moduleProxySpecs: FrontendModuleProxySpec[];
  }[] = [];

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(root, entry.package);
    const cellYamlPath = resolve(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) continue;
    const config = loadCellConfig(cellDir);
    if (!config.frontend?.dir) continue;
    const routeRules = deriveRouteRulesFromCellConfig(config);
    const frontendRouteRules = deriveFrontendRouteRulesFromCellConfig(entry.mount, config);
    const moduleProxySpecs = deriveFrontendModuleProxySpecs(entry.mount, cellDir, config);
    cellsWithFrontend.push({
      mount: entry.mount,
      packageName: entry.package,
      routeRules,
      frontendRouteRules,
      moduleProxySpecs,
    });
  }

  if (cellsWithFrontend.length === 0) {
    console.log("[vite] No cells with frontend, skipping Vite dev server");
    return { stop: () => {} };
  }

  const frontendRoot = resolve(root, ".otavia", "dev", "main-frontend");
  writeMainFrontendShell(frontendRoot);
  const srcDir = resolve(frontendRoot, "src");
  const generatedDir = resolve(srcDir, "generated");
  mkdirSync(generatedDir, { recursive: true });

  const generatedLoadersPath = resolve(generatedDir, "mount-loaders.ts");
  const generatedDevConfigPath = resolve(generatedDir, "main-dev-config.json");
  const firstMount = cellsWithFrontend[0].mount;
  const loadersSource = `// Auto-generated by otavia dev. Do not edit.
export const firstMount = ${JSON.stringify(firstMount)};
export const mounts = ${JSON.stringify(cellsWithFrontend.map((c) => c.mount))};
export const mountLoaders = {
${cellsWithFrontend
  .map((c) => `  ${JSON.stringify(c.mount)}: () => import(${JSON.stringify(`${c.packageName}/frontend`)}),`)
  .join("\n")}
} as Record<string, () => Promise<unknown>>;
`;
  writeFileSync(generatedLoadersPath, loadersSource, "utf-8");
  const generatedDevConfig = buildMainDevGeneratedConfig(cellsWithFrontend, backendPort, root);
  writeFileSync(generatedDevConfigPath, JSON.stringify(generatedDevConfig, null, 2), "utf-8");

  const env = {
    ...process.env,
    OTAVIA_MOUNTS: JSON.stringify(cellsWithFrontend.map((c) => c.mount)),
    OTAVIA_FIRST_MOUNT: firstMount,
    VITE_PORT: String(vitePort),
    GATEWAY_BACKEND_PORT: String(backendPort),
    OTAVIA_MAIN_ROOT: root,
  };

  const configPath = resolve(frontendRoot, "vite.config.ts");
  const child = Bun.spawn(["bun", "x", "vite", "--config", configPath], {
    cwd: frontendRoot,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  const stop = () => {
    child.kill();
  };

  child.exited.then((code) => {
    if (code !== 0 && code !== null) {
      console.error(`[vite] Process exited with code ${code}`);
    }
  });

  console.log(
    `[vite] Main frontend dev server starting at http://localhost:${vitePort} (mounts: ${cellsWithFrontend
      .map((c) => c.mount)
      .join(", ")})`
  );
  return { stop };
}
