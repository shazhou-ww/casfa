import { existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadOtaviaYaml } from "../../config/load-otavia-yaml.js";
import { loadCellConfig } from "../../config/load-cell-yaml.js";

const GATEWAY_VITE_ROOT_DIR = ".otavia/gateway-vite-root";

export interface ViteDevHandle {
  stop: () => void;
}

/**
 * Start the gateway Vite dev server: merged root with one path per cell frontend,
 * proxy API/non-asset requests to the backend. If no cell has frontend, returns a no-op stop.
 */
export async function startViteDev(
  rootDir: string,
  backendPort: number,
  vitePort: number
): Promise<ViteDevHandle> {
  const root = resolve(rootDir);
  const otavia = loadOtaviaYaml(root);
  const cellsWithFrontend: { cellId: string; frontendDir: string }[] = [];

  for (const cellId of otavia.cells) {
    const cellDir = resolve(root, "apps", cellId);
    const cellYamlPath = resolve(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) continue;
    const config = loadCellConfig(cellDir);
    if (!config.frontend?.dir) continue;
    const frontendDir = resolve(cellDir, config.frontend.dir);
    if (!existsSync(frontendDir)) {
      console.warn(`[vite] Skipping cell "${cellId}": frontend dir not found at ${frontendDir}`);
      continue;
    }
    cellsWithFrontend.push({ cellId, frontendDir });
  }

  if (cellsWithFrontend.length === 0) {
    console.log("[vite] No cells with frontend, skipping Vite dev server");
    return { stop: () => {} };
  }

  const mergedRoot = resolve(root, GATEWAY_VITE_ROOT_DIR);
  if (existsSync(mergedRoot)) {
    rmSync(mergedRoot, { recursive: true });
  }
  mkdirSync(mergedRoot, { recursive: true });

  for (const { cellId, frontendDir } of cellsWithFrontend) {
    const linkPath = resolve(mergedRoot, cellId);
    symlinkSync(frontendDir, linkPath);
  }

  const gatewayViteRoots = cellsWithFrontend.map(({ cellId }) => ({
    pathPrefix: `/${cellId}`,
    name: cellId,
  }));

  const otaviaPkgDir = resolve(root, "apps", "otavia");
  const configPath = resolve(otaviaPkgDir, "scripts", "gateway-vite.config.ts");
  const env = {
    ...process.env,
    GATEWAY_MERGED_ROOT: mergedRoot,
    GATEWAY_VITE_ROOTS: JSON.stringify(gatewayViteRoots),
    VITE_PORT: String(vitePort),
    GATEWAY_BACKEND_PORT: String(backendPort),
  };

  const child = Bun.spawn([process.execPath, "run", "vite", "--config", configPath], {
    cwd: otaviaPkgDir,
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

  console.log(`[vite] Dev server starting at http://localhost:${vitePort} (cells: ${cellsWithFrontend.map((c) => c.cellId).join(", ")})`);
  return { stop };
}
