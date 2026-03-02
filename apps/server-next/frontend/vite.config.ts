import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Connect } from "vite";
import * as http from "node:http";

const API_HOST = "localhost";
const API_PORT = 7101;
const RETRY_DELAY_MS = 1000;
const MAX_RETRIES = 60; // ~60s max wait

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Proxy /api to API server with retry on ECONNREFUSED (wait for API to start). */
function proxyApiWithRetry(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api")) {
      return next();
    }
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = `${url.pathname}${url.search}`;
    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : null;

    const tryOne = (): Promise<http.IncomingMessage> =>
      new Promise((resolve, reject) => {
        const options: http.RequestOptions = {
          hostname: API_HOST,
          port: API_PORT,
          path,
          method,
          headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
        };
        const proxyReq = http.request(options, (proxyRes) => resolve(proxyRes));
        proxyReq.on("error", reject);
        if (body) proxyReq.write(body);
        proxyReq.end();
      });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const proxyRes = await tryOne();
        res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      } catch (e) {
        const isRefused =
          (e as NodeJS.ErrnoException)?.code === "ECONNREFUSED" ||
          (e as Error)?.message?.includes("ECONNREFUSED");
        if (!isRefused || attempt === MAX_RETRIES - 1) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Bad Gateway", message: String((e as Error)?.message ?? e) }));
          return;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Service Unavailable",
        message: "API server did not become ready in time. Is it starting?",
      })
    );
  };
}

/** Vite plugin: proxy /api with retry so dev doesn't 500 while API is starting. */
function apiProxyRetryPlugin(): import("vite").Plugin {
  return {
    name: "api-proxy-retry",
    configureServer(server) {
      server.middlewares.use(proxyApiWithRetry());
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), apiProxyRetryPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 7100,
    // /api is handled only by apiProxyRetryPlugin (retry on ECONNREFUSED); no default proxy
    proxy: {},
  },
});
