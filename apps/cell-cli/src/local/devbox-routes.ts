import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEVBOX_ROUTES_PATH } from "../config/devbox-config.js";

export type RoutesMap = Record<string, number>;

/**
 * Read devbox routes from JSON file. Returns {} if file does not exist or is invalid.
 */
export function readRoutes(routesPath: string = DEVBOX_ROUTES_PATH): RoutesMap {
  if (!existsSync(routesPath)) return {};
  try {
    const raw = readFileSync(routesPath, "utf-8");
    const data = JSON.parse(raw) as unknown;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
    const out: RoutesMap = {};
    for (const [host, port] of Object.entries(data)) {
      if (typeof host === "string" && typeof port === "number" && Number.isInteger(port))
        out[host] = port;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Write routes map to JSON file. Creates parent directory if needed.
 */
export function writeRoutes(routes: RoutesMap, routesPath: string = DEVBOX_ROUTES_PATH): void {
  const dir = dirname(routesPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(routesPath, JSON.stringify(routes, null, 2) + "\n", "utf-8");
}

/**
 * Add or update one host → port entry in the routes file.
 */
export function registerRoute(
  host: string,
  port: number,
  routesPath: string = DEVBOX_ROUTES_PATH
): void {
  const routes = readRoutes(routesPath);
  routes[host] = port;
  writeRoutes(routes, routesPath);
}

/**
 * Remove one host from the routes file.
 */
export function unregisterRoute(host: string, routesPath: string = DEVBOX_ROUTES_PATH): void {
  const routes = readRoutes(routesPath);
  delete routes[host];
  writeRoutes(routes, routesPath);
}
