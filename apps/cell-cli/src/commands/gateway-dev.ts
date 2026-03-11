import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CellConfig } from "../config/cell-yaml-schema.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { loadStackYaml } from "../config/load-stack-yaml.js";
import { loadEnvFiles } from "../utils/env.js";
import { resolveConfig } from "../config/resolve-config.js";
import { Hono } from "hono";

export interface GatewayCellInfo {
  name: string;
  pathPrefix: string;
  cellDir: string;
  config: CellConfig;
  resolvedConfig?: ResolvedConfig;
  /** Set for cells with frontend: Vite dev server port (e.g. 7100, 7120). */
  vitePort?: number;
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
 * When port is provided, resolveConfig is called with platformContext so CELL_BASE_URL and SSO_BASE_URL are set.
 */
export function discoverCellsFromStack(
  rootDir: string,
  options?: { port?: number }
): {
  cells: GatewayCellInfo[];
  ssoPathPrefix: string;
} {
  const stack = loadStackYaml(rootDir);
  if (!stack) {
    throw new Error("stack.yaml not found in " + rootDir);
  }
  const cells: GatewayCellInfo[] = [];
  let ssoPathPrefix = "/sso";
  const port = options?.port;

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
        ...(port != null && port > 0
          ? {
              platformContext: {
                origin: `http://localhost:${port}`,
                pathPrefix,
                ssoPathPrefix,
              },
            }
          : {}),
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

/** Base port for gateway Vite dev servers; each cell with frontend gets basePort + index * 20. */
const GATEWAY_VITE_PORT_BASE = 7100;

/** Pipe a readable stream to target with a label prefix (e.g. [vite:sso]). */
function pipeWithLabel(
  stream: ReadableStream<Uint8Array>,
  label: string,
  target: NodeJS.WriteStream
): void {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const prefix = `\x1b[36m[${label}]\x1b[0m `;
  (async () => {
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        target.write(`${prefix + line}\n`);
      }
    }
    if (buffer) target.write(`${prefix + buffer}\n`);
  })();
}

/** Load cell's gateway app factory from backend/gateway-app.ts (createAppForGateway). */
async function loadCellGatewayApp(
  cellDir: string
): Promise<((env: Record<string, string>) => Hono) | null> {
  const gatewayAppPath = resolve(cellDir, "backend", "gateway-app.ts");
  if (!existsSync(gatewayAppPath)) {
    return null;
  }
  try {
    const mod = await import(pathToFileURL(gatewayAppPath).href);
    if (typeof mod?.createAppForGateway === "function") {
      return mod.createAppForGateway;
    }
  } catch {
    // Module load error
  }
  return null;
}

/**
 * Start platform gateway dev: single HTTP server with Hono app mounting each cell at its pathPrefix.
 * Port from env PORT or 8900. GET / → 301 to /sso/; GET /pathPrefix (no trailing slash) → 301 to /pathPrefix/.
 */
export async function gatewayDevCommand(options?: {
  rootDir?: string;
  port?: number;
}): Promise<void> {
  const rootDir = resolve(options?.rootDir ?? process.cwd());
  const port =
    options?.port ??
    parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

  const { cells, ssoPathPrefix } = discoverCellsFromStack(rootDir, { port });
  console.log(
    `[gateway-dev] Discovered ${cells.length} cell(s): ${cells.map((c) => c.name + "@" + c.pathPrefix).join(", ")}`
  );
  console.log(`[gateway-dev] SSO path prefix: ${ssoPathPrefix}`);

  const gatewayApp = new Hono();

  // GET / → 301 redirect to default cell (sso) or HTML with links
  gatewayApp.get("/", (c) => {
    return c.redirect(ssoPathPrefix + "/", 301);
  });

  // GET /pathPrefix (exact, no trailing slash) → 301 to /pathPrefix/ (register before mounting so we win)
  for (const cell of cells) {
    if (cell.pathPrefix === "/") continue;
    const prefixNoLeading = cell.pathPrefix.replace(/^\//, "");
    gatewayApp.get(`/${prefixNoLeading}`, (c) => {
      return c.redirect(cell.pathPrefix + "/", 301);
    });
  }

  // Build cell apps and mount (order: trailing-slash forward first, then route)
  for (const cell of cells) {
    if (!cell.resolvedConfig?.envVars) {
      console.warn(`[gateway-dev] Skipping mount for "${cell.name}": no resolvedConfig`);
      continue;
    }
    const createApp = await loadCellGatewayApp(cell.cellDir);
    if (!createApp) {
      console.warn(
        `[gateway-dev] No gateway-app.ts (createAppForGateway) for "${cell.name}", skipping mount`
      );
      continue;
    }
    const cellApp = createApp(cell.resolvedConfig.envVars);

    // GET /pathPrefix/ (exact) → forward to cell app as "/" (Hono route("/sso", app) may not match /sso/)
    if (cell.pathPrefix !== "/") {
      const prefixWithSlash = cell.pathPrefix.replace(/\/+$/, "") + "/";
      gatewayApp.get(prefixWithSlash, async (c) => {
        const u = new URL(c.req.url);
        const newUrl = new URL("/" + (u.search || ""), u.origin);
        const newReq = new Request(newUrl, { method: c.req.method, headers: c.req.headers, body: c.req.body });
        return cellApp.fetch(newReq);
      });
    }

    gatewayApp.route(cell.pathPrefix, cellApp);
    console.log(`[gateway-dev] Mounted ${cell.name} at ${cell.pathPrefix}`);
  }

  // Assign Vite ports and start Vite dev server per cell that has frontend
  const cellsWithFrontend = cells.filter((c) => c.config.frontend && c.resolvedConfig?.frontend);
  for (let i = 0; i < cellsWithFrontend.length; i++) {
    const cell = cellsWithFrontend[i];
    cell.vitePort = cell.config.dev?.portBase ?? GATEWAY_VITE_PORT_BASE + i * 20;
  }
  // Detect duplicate ports (e.g. two cells with same portBase) and reassign
  const usedPorts = new Set<number>();
  for (const cell of cellsWithFrontend) {
    if (cell.vitePort != null && usedPorts.has(cell.vitePort)) {
      cell.vitePort = GATEWAY_VITE_PORT_BASE + cellsWithFrontend.indexOf(cell) * 20;
    }
    if (cell.vitePort != null) usedPorts.add(cell.vitePort);
  }

  const gatewayViteConfigPath = resolve(rootDir, "apps", "cell-cli", "scripts", "gateway-vite.config.ts");
  const viteChildren: Array<ReturnType<typeof Bun.spawn>> = [];

  for (const cell of cellsWithFrontend) {
    if (cell.vitePort == null) continue;
    const basePath = cell.pathPrefix.endsWith("/") ? cell.pathPrefix : cell.pathPrefix + "/";
    const env = {
      ...process.env,
      BASE_PATH: basePath,
      ROOT_DIR: cell.resolvedConfig!.frontend!.dir,
      VITE_PORT: String(cell.vitePort),
    };
    console.log(`[gateway-dev] Starting Vite for ${cell.name} on port ${cell.vitePort} (base: ${basePath})...`);
    const proc = Bun.spawn(
      ["bunx", "vite", "--config", gatewayViteConfigPath],
      {
        cwd: cell.cellDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    viteChildren.push(proc);
    pipeWithLabel(proc.stdout as ReadableStream<Uint8Array>, `vite:${cell.name}`, process.stdout);
    pipeWithLabel(proc.stderr as ReadableStream<Uint8Array>, `vite:${cell.name}`, process.stderr);
  }

  /** Proxy a request to a cell's Vite server: strip pathPrefix from path and forward to localhost:vitePort. */
  async function proxyToVite(req: Request, pathPrefix: string, vitePort: number): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const stripped = pathname.slice(pathPrefix.length) || "/";
    const upstreamUrl = `http://127.0.0.1:${vitePort}${stripped}${url.search}`;
    const headers = new Headers(req.headers);
    headers.set("Host", `127.0.0.1:${vitePort}`);
    const proxyReq = new Request(upstreamUrl, {
      method: req.method,
      headers,
      body: req.body,
      duplex: "half",
    });
    return fetch(proxyReq);
  }

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: async (req, server) => {
      const res = await gatewayApp.fetch(req, server);
      if (res.status !== 404) return res;
      const pathname = new URL(req.url).pathname;
      const cell = cells
        .filter(
          (c) =>
            c.vitePort != null &&
            (pathname === c.pathPrefix || pathname.startsWith(c.pathPrefix + "/"))
        )
        .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];
      if (!cell?.vitePort) return res;
      return proxyToVite(req, cell.pathPrefix, cell.vitePort);
    },
  });

  console.log(`[gateway-dev] Gateway running at http://localhost:${server.port}`);

  const cleanup = () => {
    for (const child of viteChildren) {
      child.kill();
    }
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  await new Promise(() => {});
}
