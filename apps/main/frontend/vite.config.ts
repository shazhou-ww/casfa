import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.GATEWAY_BACKEND_PORT ?? "8900";
const vitePort = parseInt(process.env.VITE_PORT ?? "7100", 10);
const backendTarget = `http://localhost:${backendPort}`;

const mounts: string[] = (() => {
  try {
    const parsed = JSON.parse(process.env.OTAVIA_MOUNTS ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
})();

const mountSet = new Set(mounts);
const apiPrefixes = ["/api", "/oauth", "/.well-known", "/mcp"];

function extractMountFromPath(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return mountSet.has(seg) ? seg : null;
}

function isApiLike(pathname: string): boolean {
  return apiPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function mountAwareApiRewritePlugin(): Plugin {
  return {
    name: "otavia-mount-aware-api-rewrite",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const parsed = new URL(url, "http://localhost");
        const pathname = parsed.pathname;

        const alreadyMounted = extractMountFromPath(pathname);
        if (alreadyMounted) {
          next();
          return;
        }
        if (!isApiLike(pathname)) {
          next();
          return;
        }

        const referer = req.headers.referer;
        let mount = mounts[0];
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
          req.url = `/${mount}${pathname}${parsed.search}`;
        }
        next();
      });
    },
  };
}

const proxy: Record<string, object> = {};
for (const mount of mounts) {
  for (const p of apiPrefixes) {
    proxy[`/${mount}${p}`] = { target: backendTarget };
  }
}

export default defineConfig({
  plugins: [mountAwareApiRewritePlugin(), react()],
  // Main frontend dynamically imports mounted cell frontends (workspace packages).
  // Force React to resolve to a single instance to avoid invalid hook call errors.
  resolve: { conditions: ["bun"], dedupe: ["react", "react-dom"] },
  server: {
    port: vitePort,
    host: "0.0.0.0",
    strictPort: true,
    proxy,
  },
});
