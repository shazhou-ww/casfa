/**
 * Devbox local reverse proxy: listens on tunnelPort, reads devbox-routes.json,
 * and forwards each request by Host header to the corresponding localhost:port.
 * WebSocket (e.g. Vite HMR) is forwarded so the dev server connection works through the tunnel.
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

/** Forward WebSocket client -> proxy ws (so Vite HMR messages reach the browser). */
function pipeClientToWs(client: WebSocket, ws: import("bun").ServerWebSocket<{ targetPort: number; pathname: string; search: string }>) {
  client.addEventListener("message", (ev) => {
    try {
      ws.send(ev.data as string | Buffer);
    } catch {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  });
  client.addEventListener("close", () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
  client.addEventListener("error", () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req, server) {
    const host = req.headers.get("host")?.split(":")[0] ?? "";
    const routes = readRoutes(routesPath);
    const targetPort = routes[host];
    if (targetPort == null) {
      return new Response("No route for host: " + host, { status: 404 });
    }

    // WebSocket upgrade (e.g. Vite HMR): forward to backend and pipe both ways
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const url = new URL(req.url);
      const ok = server.upgrade(req, {
        data: { targetPort, pathname: url.pathname, search: url.search },
      });
      if (ok) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
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
  websocket: {
    open(ws) {
      const { targetPort, pathname, search } = ws.data;
      const backendUrl = `ws://127.0.0.1:${targetPort}${pathname}${search}`;
      try {
        const client = new WebSocket(backendUrl);
        (ws as unknown as { _client?: WebSocket })._client = client;
        pipeClientToWs(client, ws);
        client.addEventListener("open", () => {});
      } catch (e) {
        console.error("WebSocket proxy backend connect failed:", e);
        ws.close();
      }
    },
    message(ws, message) {
      const client = (ws as unknown as { _client?: WebSocket })._client;
      if (client?.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch {
          ws.close();
        }
      }
    },
    close(ws) {
      const client = (ws as unknown as { _client?: WebSocket })._client;
      if (client) {
        try {
          client.close();
        } catch {
          /* ignore */
        }
      }
    },
  },
});

console.log(`Devbox proxy listening on port ${port}. Routes: ${routesPath}`);
