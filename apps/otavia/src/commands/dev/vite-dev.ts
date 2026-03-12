import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
};

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
  cells: Array<{ mount: string; routeRules: RouteRule[] }>,
  backendPort: number
): MainDevGeneratedConfig {
  const mounts = cells.map((c) => c.mount);
  const firstMount = mounts[0] ?? "";
  const routeRulesMap = new Map<string, RouteRule>();
  const proxyRules: ProxyRule[] = [];
  const target = `http://localhost:${backendPort}`;

  for (const cell of cells) {
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
  };
}

/**
 * Start main frontend Vite dev server (single root MPA shell):
 * - root is apps/main/frontend
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
    hasServiceWorker: boolean;
    swEntryPath?: string;
    routeRules: RouteRule[];
  }[] = [];

  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(root, entry.package);
    const cellYamlPath = resolve(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) continue;
    const config = loadCellConfig(cellDir);
    if (!config.frontend?.dir) continue;
    const hasServiceWorker = Boolean(config.frontend.entries?.sw?.entry);
    const swEntryPath =
      hasServiceWorker && config.frontend.entries?.sw?.entry
        ? resolve(cellDir, config.frontend.dir, config.frontend.entries.sw.entry).replace(/\\/g, "/")
        : undefined;
    const routeRules = deriveRouteRulesFromCellConfig(config);
    cellsWithFrontend.push({
      mount: entry.mount,
      packageName: entry.package,
      hasServiceWorker,
      swEntryPath,
      routeRules,
    });
  }

  if (cellsWithFrontend.length === 0) {
    console.log("[vite] No cells with frontend, skipping Vite dev server");
    return { stop: () => {} };
  }

  const frontendRoot = resolve(root, "frontend");
  if (!existsSync(frontendRoot)) {
    throw new Error(
      `main frontend root not found at ${frontendRoot}. Create apps/main/frontend first.`
    );
  }
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
  const generatedDevConfig = buildMainDevGeneratedConfig(cellsWithFrontend, backendPort);
  writeFileSync(generatedDevConfigPath, JSON.stringify(generatedDevConfig, null, 2), "utf-8");

  // Regenerate service worker proxy entries for cells that expose frontend/sw.
  for (const entryName of readdirSync(frontendRoot, { withFileTypes: true })) {
    if (!entryName.isDirectory()) continue;
    const mount = entryName.name;
    const dirPath = resolve(frontendRoot, mount);
    const swPath = resolve(dirPath, "sw.ts");
    const isKnownMount = cellsWithFrontend.some((c) => c.mount === mount);
    if (!isKnownMount && existsSync(swPath)) {
      rmSync(swPath, { force: true });
    }
  }
  for (const cell of cellsWithFrontend) {
    if (!cell.hasServiceWorker || !cell.swEntryPath) continue;
    const mountDir = resolve(frontendRoot, cell.mount);
    mkdirSync(mountDir, { recursive: true });
    const swProxyPath = resolve(mountDir, "sw.ts");
    const swProxySource = `// Auto-generated by otavia dev. Do not edit.
import ${JSON.stringify(`/@fs/${cell.swEntryPath}`)};
`;
    writeFileSync(swProxyPath, swProxySource, "utf-8");
  }

  const env = {
    ...process.env,
    OTAVIA_MOUNTS: JSON.stringify(cellsWithFrontend.map((c) => c.mount)),
    OTAVIA_FIRST_MOUNT: firstMount,
    VITE_PORT: String(vitePort),
    GATEWAY_BACKEND_PORT: String(backendPort),
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
