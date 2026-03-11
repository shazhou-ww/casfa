/**
 * Devbox local reverse proxy: listens on tunnelPort, reads devbox-routes.json,
 * and forwards each request by Host header to the corresponding localhost:port.
 * Run via: bun run apps/cell-cli/src/local/devbox-proxy.ts
 * Or after prepare: the proxy can be started by the user (see devbox info).
 */
import { loadDevboxConfig, DEVBOX_ROUTES_PATH } from "../config/devbox-config.js";
import { readRoutes } from "./devbox-routes.js";

const devbox = loadDevboxConfig();
if (!devbox) {
  console.error("No devbox config found at ~/.config/casfa/devbox.yaml. Run 'cell devbox prepare' first.");
  process.exit(1);
}

const port = devbox.tunnelPort;
const routesPath = devbox.proxyRegistryPath ?? DEVBOX_ROUTES_PATH;

Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const host = req.headers.get("host")?.split(":")[0] ?? "";
    const routes = readRoutes(routesPath);
    const targetPort = routes[host];
    if (targetPort == null) {
      return new Response("No route for host: " + host, { status: 404 });
    }
    const url = new URL(req.url);
    const targetUrl = `http://127.0.0.1:${targetPort}${url.pathname}${url.search}`;
    const headers = new Headers(req.headers);
    headers.set("Host", host);
    try {
      const res = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.body,
      });
      return res;
    } catch (e) {
      console.error("Proxy error:", e);
      return new Response("Bad Gateway", { status: 502 });
    }
  },
});

console.log(`Devbox proxy listening on port ${port}. Routes: ${routesPath}`);
