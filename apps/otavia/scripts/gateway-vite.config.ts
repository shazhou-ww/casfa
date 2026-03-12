/**
 * Gateway Vite config: single-server mode (all cells).
 * Set GATEWAY_MERGED_ROOT and GATEWAY_VITE_ROOTS to serve all cells from one Vite server.
 * Proxies API/non-asset requests under each cell path to the backend gateway.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { gatewayViteMultiRootPlugin, type GatewayViteRoot } from "./gateway-vite-multi-root-plugin.js";

const mergedRoot = process.env.GATEWAY_MERGED_ROOT;
const viteRootsJson = process.env.GATEWAY_VITE_ROOTS;
const backendPort = process.env.GATEWAY_BACKEND_PORT ?? "8900";
const vitePort = parseInt(process.env.VITE_PORT ?? "7100", 10);

const isSingleServer = Boolean(mergedRoot && viteRootsJson);

const roots: GatewayViteRoot[] = isSingleServer
  ? (() => {
      try {
        return JSON.parse(viteRootsJson!) as GatewayViteRoot[];
      } catch {
        return [];
      }
    })()
  : [];

const backendTarget = `http://localhost:${backendPort}`;

/** Requests that Vite should serve (static assets, HMR). Others are proxied to backend. */
function isAssetOrHMR(pathname: string): boolean {
  if (pathname.startsWith("/@") || pathname.startsWith("/node_modules/")) return true;
  if (pathname.includes(".")) {
    const ext = pathname.replace(/\?.*$/, "").split(".").pop()?.toLowerCase();
    const assetExts = ["js", "mjs", "ts", "tsx", "jsx", "css", "scss", "less", "json", "wasm", "ico", "png", "jpg", "jpeg", "gif", "svg", "webp", "woff", "woff2", "ttf", "eot", "map"];
    if (ext && assetExts.includes(ext)) return true;
  }
  return false;
}

function proxyEntry(pathPrefix: string) {
  const prefix = pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
  return {
    target: backendTarget,
    bypass(req: { url?: string }) {
      const pathname = req.url ? new URL(req.url, "http://x").pathname : "";
      if (!pathname.startsWith(prefix + "/") && pathname !== prefix) return undefined;
      const after = pathname.slice(prefix.length) || "/";
      if (isAssetOrHMR(after)) return req.url ?? pathname;
      return undefined;
    },
  };
}

const proxy: Record<string, object> = {};
for (const r of roots) {
  const key = r.pathPrefix.endsWith("/") ? r.pathPrefix.slice(0, -1) : r.pathPrefix;
  proxy[key] = proxyEntry(r.pathPrefix);
}

export default defineConfig(
  isSingleServer
    ? {
        root: mergedRoot!,
        base: "",
        plugins: [react(), gatewayViteMultiRootPlugin(roots)],
        resolve: { conditions: ["bun"] },
        server: {
          port: vitePort,
          host: "0.0.0.0",
          strictPort: true,
          proxy,
        },
        build: { outDir: "dist", emptyOutDir: true },
      }
    : {
        root: process.cwd(),
        base: "/",
        plugins: [react()],
        resolve: { conditions: ["bun"] },
        server: { port: vitePort, host: "0.0.0.0", strictPort: true },
        build: { outDir: "dist", emptyOutDir: true },
      }
);
