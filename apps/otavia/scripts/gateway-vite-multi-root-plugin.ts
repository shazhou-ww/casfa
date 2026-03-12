/**
 * Vite plugin for gateway single-server mode: rewrite index.html so that root-relative
 * asset paths (src="/, href="/) get the request's path prefix (e.g. /sso/, /agent/).
 * This allows one Vite server with root = merged dir (e.g. .otavia/gateway-vite-root with
 * sso -> apps/sso/frontend, agent -> apps/agent/frontend) to serve multiple cells.
 *
 * Expects env GATEWAY_VITE_ROOTS = JSON array of { pathPrefix: string, name: string }.
 */

import type { Plugin } from "vite";

export interface GatewayViteRoot {
  pathPrefix: string;
  name: string;
}

function getPathPrefixFromPath(path: string, roots: GatewayViteRoot[]): string | null {
  const normalized = path.replace(/^\//, "").split("/")[0];
  if (!normalized) return null;
  const withSlash = "/" + normalized;
  const found = roots.find(
    (r) => r.pathPrefix === withSlash || r.pathPrefix.replace(/^\//, "") === normalized
  );
  return found ? (found.pathPrefix.endsWith("/") ? found.pathPrefix : found.pathPrefix + "/") : null;
}

export function gatewayViteMultiRootPlugin(roots: GatewayViteRoot[]): Plugin {
  if (roots.length === 0) {
    return { name: "gateway-vite-multi-root" };
  }
  return {
    name: "gateway-vite-multi-root",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const path = (ctx as { path?: string; originalUrl?: string }).path ?? (ctx as { originalUrl?: string }).originalUrl ?? "";
        const prefix = getPathPrefixFromPath(path, roots);
        if (!prefix) return html;
        // Rewrite root-relative URLs so assets and HMR go under the path prefix.
        // Match src="/ or href="/ (avoid doubling prefix and avoid http/https)
        const prefixSlash = prefix.endsWith("/") ? prefix : prefix + "/";
        return html
          .replace(/\s(src|href)=(["'])(\/)(?!\/)/g, (_, attr, quote) => `${attr}=${quote}${prefixSlash}`)
          .replace(/\s(src|href)=(["'])\.\//g, (_, attr, quote) => `${attr}=${quote}${prefixSlash}`);
      },
    },
  };
}
