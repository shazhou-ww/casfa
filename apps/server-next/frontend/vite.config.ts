import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Connect } from "vite";
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";

const API_HOST = "localhost";
const API_PORT = 7101;
const RETRY_DELAY_MS = 1000;
const MAX_RETRIES = 60; // ~60s max wait

const LOG_PREFIX = "[vite-mcp]";

function logMcp(msg: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const extraStr = extra ? " " + JSON.stringify(extra) : "";
  console.log(`${LOG_PREFIX} ${ts} ${msg}${extraStr}`);
}

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** OAuth discovery: Cursor requires authorization_endpoint, token_endpoint, response_types_supported, and registration_endpoint. */
function getMcpOAuthDiscovery(host: string): Record<string, unknown> {
  const issuer = `http://${host}`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/mcp/token`,
    registration_endpoint: `${issuer}/.well-known/oauth-registration`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
  };
}

const MCP_OAUTH_DISCOVERY_JSON = getMcpOAuthDiscovery("localhost:7100");

/** Proxy /api to API server with retry on ECONNREFUSED (wait for API to start). */
function proxyApiWithRetry(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const pathname = req.url?.split("?")[0] ?? "";
    const host = req.headers.host ?? "localhost:7100";
    // Serve .well-known discovery (authorization is at /oauth/authorize, token at /api/oauth/mcp/token).
    if (pathname.startsWith("/.well-known/oauth-authorization-server")) {
      logMcp("GET .well-known/oauth-authorization-server → 200 (local)");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(getMcpOAuthDiscovery(host)));
      return;
    }
    // Dynamic client registration: Cursor POSTs to register; return 201 with minimal client so it proceeds (then token exchange gets 400 "use Bearer").
    if (pathname.startsWith("/.well-known/oauth-registration")) {
      logMcp("POST .well-known/oauth-registration → 201 (local)");
      res.statusCode = 201;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          client_id: "cursor-mcp-casfa-next-local",
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"],
        })
      );
      return;
    }
    if (!pathname.startsWith("/api")) {
      if (pathname.startsWith("/oauth")) {
        logMcp("frontend route", { path: pathname, method: req.method });
      }
      return next();
    }
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = `${url.pathname}${url.search}`;
    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : null;

    const isMcp = pathname.startsWith("/api/mcp");
    const isMcpToken = pathname === "/api/oauth/mcp/token" && method === "POST";
    const isMcpAuthorize = pathname === "/api/oauth/mcp/authorize" && method === "POST";
    const authHeader = req.headers.authorization;
    const hasAuth = Boolean(authHeader?.startsWith("Bearer ") && authHeader.length > 10);
    const logMeta: Record<string, unknown> = { method, path: pathname };
    if (isMcp) logMeta.auth = hasAuth ? "Bearer present" : "no Bearer";
    if (isMcpAuthorize) logMeta.note = "user consent → create auth code";
    if (isMcpToken && body) {
      try {
        const params = Object.fromEntries(new URLSearchParams(body.toString("utf8")));
        logMeta.grant_type = params.grant_type;
        logMeta.has_code = Boolean(params.code);
        logMeta.code_len = params.code?.length ?? 0;
        logMeta.has_code_verifier = Boolean(params.code_verifier);
        logMeta.redirect_uri = params.redirect_uri ?? "(none)";
      } catch {
        logMeta.body_preview = body.length;
      }
    }
    logMcp("proxy → backend", logMeta);

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
        const status = proxyRes.statusCode ?? 500;
        logMcp("proxy ← backend", { path: pathname, status });
        res.writeHead(status, proxyRes.headers);
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

/** Vite plugin: emit .well-known/oauth-authorization-server at build for S3+CloudFront. Dev is handled in apiProxyRetryPlugin. */
function wellKnownMcpPlugin(): import("vite").Plugin {
  return {
    name: "well-known-mcp",
    writeBundle() {
      const out = path.join(__dirname, "dist", ".well-known", "oauth-authorization-server");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(MCP_OAUTH_DISCOVERY_JSON), "utf8");
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), apiProxyRetryPlugin(), wellKnownMcpPlugin()],
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
