import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CellConfig } from "../config/cell-yaml-schema.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { loadStackYaml } from "../config/load-stack-yaml.js";
import { loadEnvFiles } from "../utils/env.js";
import { resolveConfig } from "../config/resolve-config.js";

export interface GatewayCellInfo {
  name: string;
  pathPrefix: string;
  cellDir: string;
  config: CellConfig;
  resolvedConfig?: ResolvedConfig;
}

/**
 * Normalize pathPrefix: leading slash, no trailing slash (e.g. /sso, /agent).
 */
function normalizePathPrefix(raw: string): string {
  const s = raw.trim();
  if (!s) return "/";
  const withLeading = s.startsWith("/") ? s : `/${s}`;
  return withLeading.replace(/\/+$/, "") || "/";
}

/**
 * Discover cells from stack.yaml: load each cell's cell.yaml from apps/<name>/cell.yaml,
 * resolve pathPrefix (warn and use "/" + name when missing).
 * Picks first cell with name === 'sso' for ssoPathPrefix.
 */
export function discoverCellsFromStack(rootDir: string): {
  cells: GatewayCellInfo[];
  ssoPathPrefix: string;
} {
  const stack = loadStackYaml(rootDir);
  if (!stack) {
    throw new Error("stack.yaml not found in " + rootDir);
  }
  const cells: GatewayCellInfo[] = [];
  let ssoPathPrefix = "/sso";

  for (const name of stack.cells) {
    const cellDir = resolve(rootDir, "apps", name);
    const cellYamlPath = resolve(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) {
      console.warn(`[gateway-dev] Skipping cell "${name}": cell.yaml not found at ${cellYamlPath}`);
      continue;
    }
    const config = loadCellConfig(cellDir);
    let pathPrefix: string;
    if (config.pathPrefix != null && String(config.pathPrefix).trim() !== "") {
      pathPrefix = normalizePathPrefix(String(config.pathPrefix));
    } else {
      console.warn(
        `[gateway-dev] Cell "${name}" has no pathPrefix in cell.yaml; using "/${name}"`
      );
      pathPrefix = normalizePathPrefix("/" + name);
    }
    if (name === "sso") {
      ssoPathPrefix = pathPrefix;
    }
    let resolvedConfig: ResolvedConfig | undefined;
    try {
      const envMap = loadEnvFiles(cellDir);
      resolvedConfig = resolveConfig(config, envMap, "dev", {
        onMissingParam: "placeholder",
      });
    } catch {
      // Optional for placeholder server; Task 4 will need it
    }
    cells.push({
      name,
      pathPrefix,
      cellDir,
      config,
      resolvedConfig,
    });
  }

  return { cells, ssoPathPrefix };
}

const DEFAULT_PORT = 8900;

/**
 * Start platform gateway dev: single HTTP server with placeholder response.
 * Port from env PORT or 8900. Responds with 200 and body "gateway running".
 */
export async function gatewayDevCommand(options?: {
  rootDir?: string;
  port?: number;
}): Promise<void> {
  const rootDir = resolve(options?.rootDir ?? process.cwd());
  const port =
    options?.port ??
    parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

  const { cells, ssoPathPrefix } = discoverCellsFromStack(rootDir);
  console.log(
    `[gateway-dev] Discovered ${cells.length} cell(s): ${cells.map((c) => c.name + "@" + c.pathPrefix).join(", ")}`
  );
  console.log(`[gateway-dev] SSO path prefix: ${ssoPathPrefix}`);

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch(_req) {
      return new Response("gateway running", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    },
  });

  console.log(`[gateway-dev] Gateway running at http://localhost:${server.port}`);

  const cleanup = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  await new Promise(() => {});
}
