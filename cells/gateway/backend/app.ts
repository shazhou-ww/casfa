export { createAppForGateway as createAppForBackend } from "./gateway-app";
export { createAppForGateway } from "./gateway-app";
import { getTokenFromRequest } from "@casfa/cell-auth-server";
import { createDelegateOAuthRoutes, createMemoryAuthCodeStore, type DelegateGrantStore } from "@casfa/cell-delegates-server";
import { createDelegatesRoutes } from "@casfa/cell-delegates-server";
import type { OAuthServer } from "@casfa/cell-cognito-server";
import type { PendingClientInfoStore } from "@casfa/cell-delegates-server";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "./config.ts";
import { createLoginRedirectRoutes } from "./controllers/login-redirect.ts";
import { createGatewayMcpRoutes } from "./mcp.ts";
import type { Env, UserAuth } from "./types.ts";
import type { ServerRegistry } from "./services/server-registry.ts";
import type { ServerOAuthStateStore } from "./services/server-oauth-state.ts";
import {
  discoverServerOAuth,
  generatePkce,
  isOAuthProtectedResource,
  normalizeReturnUrl,
  resolveOAuthClientId,
  type PendingServerOAuth,
} from "./services/server-oauth-flow.ts";
import { getToolsForServers } from "./services/tool-discovery.ts";

export type AppDeps = {
  config: ServerConfig;
  oauthServer: OAuthServer;
  grantStore: DelegateGrantStore;
  pendingClientInfoStore: PendingClientInfoStore;
  serverRegistry: ServerRegistry;
  oauthStateStore: ServerOAuthStateStore;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  const pendingServerOAuth = new Map<string, PendingServerOAuth>();

  function allocateServerId(): string {
    return `srv_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }

  function requireUser(c: Context<Env>): UserAuth | null {
    const auth = c.get("auth");
    if (!auth || auth.type !== "user") return null;
    return auth;
  }

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  app.use("*", async (c, next) => {
    const token = getTokenFromRequest(c.req.raw, {
      cookieName: deps.config.auth.cookieName ?? "auth",
      cookieOnly: false,
    });
    if (!token) return next();
    const auth = await deps.oauthServer.resolveAuth(token);
    if (!auth) return next();
    if (auth.type === "user") {
      c.set("auth", {
        type: "user",
        userId: auth.userId,
        email: auth.email,
        name: auth.name,
        picture: auth.picture,
      });
      return next();
    }
    c.set("auth", {
      type: "delegate",
      realmId: auth.userId,
      delegateId: auth.delegateId,
      permissions: auth.permissions,
    });
    return next();
  });

  const oauthRoutes = createLoginRedirectRoutes(deps.config, {
    pendingClientInfoStore: deps.pendingClientInfoStore,
  });
  app.route("/", oauthRoutes);
  app.route(
    "/",
    createDelegateOAuthRoutes({
      grantStore: deps.grantStore,
      authCodeStore: createMemoryAuthCodeStore(),
      getUserId: (auth: unknown) => {
        const a = auth as Env["Variables"]["auth"];
        return a?.type === "user" ? a.userId : "";
      },
      baseUrl: deps.config.baseUrl,
      allowedScopes: ["use_mcp", "manage_delegates"],
      onAuthorizeSuccess: () => deps.pendingClientInfoStore.delete("mcp"),
    })
  );
  app.route(
    "/",
    createDelegatesRoutes({
      grantStore: deps.grantStore,
      getUserId: (auth) => (auth?.type === "user" ? auth.userId : ""),
    })
  );

  const mcpRoutes = createGatewayMcpRoutes({
    serverRegistry: deps.serverRegistry,
    oauthStateStore: deps.oauthStateStore,
  });
  app.route("/", mcpRoutes);

  app.get("/api/health", (c) => c.json({ ok: true }, 200));
  app.get("/api/info", (c) =>
    c.json(
      {
        ssoBaseUrl: deps.config.ssoBaseUrl ?? null,
        baseUrl: deps.config.baseUrl || null,
      },
      200
    )
  );

  app.use("/api/*", async (c, next) => {
    const auth = requireUser(c);
    if (!auth) return c.json({ error: "UNAUTHORIZED", message: "Not authenticated user" }, 401);
    return next();
  });

  app.get("/api/me", (c) => {
    const auth = requireUser(c);
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Not authenticated" }, 401);
    }
    return c.json(
      {
        userId: auth.userId,
        email: auth.email,
        name: auth.name,
        picture: auth.picture,
      },
      200
    );
  });

  app.get("/api/servers", async (c) => {
    const auth = requireUser(c)!;
    const servers = await deps.serverRegistry.list(auth.userId);
    return c.json({ servers }, 200);
  });

  app.get("/api/servers/search", async (c) => {
    const auth = requireUser(c)!;
    const query = c.req.query("q") ?? "";
    const servers = await deps.serverRegistry.search(auth.userId, query);
    return c.json({ servers }, 200);
  });

  app.post("/api/servers", async (c) => {
    const auth = requireUser(c)!;
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      url?: string;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!name || !url) {
      return c.json({ error: "BAD_REQUEST", message: "name and url are required" }, 400);
    }
    const id = allocateServerId();
    await deps.serverRegistry.add(auth.userId, { id, name, url });
    return c.json({ added: id }, 201);
  });

  app.delete("/api/servers/:serverId", async (c) => {
    const auth = requireUser(c)!;
    const serverId = c.req.param("serverId");
    const removed = await deps.serverRegistry.remove(auth.userId, serverId);
    await deps.oauthStateStore.remove(auth.userId, serverId);
    return c.json({ removed, serverId }, 200);
  });

  app.get("/api/servers/oauth/statuses", async (c) => {
    const auth = requireUser(c)!;
    const servers = await deps.serverRegistry.list(auth.userId);
    const statuses = await Promise.all(
      servers.map(async (server) => {
        const oauthState = await deps.oauthStateStore.get(auth.userId, server.id);
        const loggedIn = Boolean(
          oauthState?.accessToken &&
            (oauthState.expiresAt === undefined || oauthState.expiresAt > Date.now())
        );
        const requiresOAuth = await isOAuthProtectedResource(`${server.url.replace(/\/$/, "")}/mcp`);
        return {
          serverId: server.id,
          requiresOAuth,
          loggedIn,
        };
      })
    );
    return c.json({ statuses }, 200);
  });

  app.get("/api/servers/:serverId/oauth/start", async (c) => {
    const auth = requireUser(c)!;
    const serverId = c.req.param("serverId").trim();
    const server = await deps.serverRegistry.get(auth.userId, serverId);
    if (!server) {
      return c.json({ error: "NOT_FOUND", message: `server not found: ${serverId}` }, 404);
    }

    const gatewayBase = deps.config.baseUrl.replace(/\/$/, "");
    const resourceUrl = `${server.url.replace(/\/$/, "")}/mcp`;
    const returnUrl = normalizeReturnUrl(c.req.query("return_url"), gatewayBase);
    const usePopup = c.req.query("popup") === "1";
    const redirectUri = `${gatewayBase}/oauth/server/callback`;

    const discovery = await discoverServerOAuth(resourceUrl);
    const state = crypto.randomUUID();
    const { verifier, challenge, method } = await generatePkce();
    const fallbackClientId = `${gatewayBase}/oauth/mcp-client-metadata`;
    const clientId = await resolveOAuthClientId({
      authorizationServer: discovery.authorizationServer,
      redirectUri,
      clientName: `Gateway MCP Client (${server.name})`,
      fallbackClientId,
    });
    const scope =
      discovery.resource.scopes_supported?.join(" ") ??
      discovery.authorizationServer.scopes_supported?.join(" ") ??
      "use_mcp";

    pendingServerOAuth.set(state, {
      state,
      userId: auth.userId,
      serverId,
      tokenEndpoint: discovery.authorizationServer.token_endpoint,
      resource: resourceUrl,
      clientId,
      redirectUri,
      codeVerifier: verifier,
      returnUrl,
      usePopup,
      expiresAt: Date.now() + 10 * 60_000,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: method,
      resource: resourceUrl,
    });
    if (scope) params.set("scope", scope);
    const authorizeUrl = `${discovery.authorizationServer.authorization_endpoint}?${params.toString()}`;
    return c.redirect(authorizeUrl);
  });

  app.post("/api/servers/:serverId/oauth/logout", async (c) => {
    const auth = requireUser(c)!;
    const serverId = c.req.param("serverId").trim();
    const removed = await deps.oauthStateStore.remove(auth.userId, serverId);
    return c.json({ removed, serverId }, 200);
  });

  app.get("/oauth/server/callback", async (c) => {
    const auth = requireUser(c);
    if (!auth) {
      const currentUrl = new URL(c.req.url).toString();
      return c.redirect(`/oauth/login?return_url=${encodeURIComponent(currentUrl)}`);
    }

    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");
    const stateForError = c.req.query("state") ?? "";
    const pendingForError = stateForError ? pendingServerOAuth.get(stateForError) : undefined;
    const usePopupForError = pendingForError?.usePopup ?? false;
    if (error) {
      if (usePopupForError) {
        const payload = JSON.stringify({
          type: "gateway-oauth-error",
          error: `${error}${errorDescription ? `: ${errorDescription}` : ""}`,
          serverId: pendingForError?.serverId ?? "",
        });
        return c.html(`<!doctype html><html><body><script>
          try {
            if (window.opener) {
              window.opener.postMessage(${payload}, window.location.origin);
            }
          } finally {
            window.close();
          }
        </script></body></html>`);
      }
      return c.text(`OAuth failed: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`, 400);
    }
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    if (!state || !code) {
      return c.text("OAuth callback missing state/code", 400);
    }

    const pending = pendingServerOAuth.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingServerOAuth.delete(state);
      return c.text("OAuth state expired or invalid", 400);
    }
    if (pending.userId !== auth.userId) {
      return c.text("OAuth user mismatch", 403);
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
      resource: pending.resource,
    });
    const tokenRes = await fetch(pending.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return c.text(`Token exchange failed: ${tokenRes.status} ${text}`, 400);
    }
    const tokenPayload = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokenPayload.access_token) {
      return c.text("Token exchange succeeded but access_token missing", 400);
    }

    await deps.oauthStateStore.set(auth.userId, {
      serverId: pending.serverId,
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      expiresAt:
        typeof tokenPayload.expires_in === "number"
          ? Date.now() + tokenPayload.expires_in * 1000
          : undefined,
    });
    pendingServerOAuth.delete(state);
    if (pending.usePopup) {
      const payload = JSON.stringify({
        type: "gateway-oauth-done",
        serverId: pending.serverId,
      });
      return c.html(`<!doctype html><html><body><script>
        try {
          if (window.opener) {
            window.opener.postMessage(${payload}, window.location.origin);
          }
        } finally {
          window.close();
        }
      </script></body></html>`);
    }
    const doneUrl = new URL(pending.returnUrl);
    doneUrl.searchParams.set("oauth", "ok");
    doneUrl.searchParams.set("serverId", pending.serverId);
    return c.redirect(doneUrl.toString());
  });

  app.post("/api/tools/get", async (c) => {
    const auth = requireUser(c)!;
    const body = (await c.req.json().catch(() => ({}))) as { serverIds?: string[] };
    const serverIds = Array.isArray(body.serverIds)
      ? [...new Set(body.serverIds.filter((id): id is string => typeof id === "string"))]
      : [];
    if (serverIds.length === 0) {
      return c.json({ error: "BAD_REQUEST", message: "serverIds is required" }, 400);
    }
    const servers = (
      await Promise.all(serverIds.map((id) => deps.serverRegistry.get(auth.userId, id)))
    ).filter((s): s is NonNullable<typeof s> => s !== null);
    const results = await getToolsForServers(auth.userId, servers, deps.oauthStateStore);
    return c.json({ results }, 200);
  });

  app.post("/api/tools/load", async (c) => {
    const auth = requireUser(c)!;
    const body = (await c.req.json().catch(() => ({}))) as {
      tools?: Array<{ serverId?: string; toolName?: string }>;
    };
    const tools = Array.isArray(body.tools)
      ? body.tools
          .filter((item) => typeof item?.serverId === "string" && typeof item?.toolName === "string")
          .map((item) => ({
            serverId: item.serverId!.trim(),
            toolName: item.toolName!.trim(),
            loadedToolName: `mcp__${item.serverId!.trim()}__${item.toolName!.trim()}`,
          }))
      : [];
    if (tools.length === 0) {
      return c.json({ error: "BAD_REQUEST", message: "tools is required" }, 400);
    }
    await Promise.all(
      tools.map(async (tool) => {
        const server = await deps.serverRegistry.get(auth.userId, tool.serverId);
        if (!server) {
          throw new Error(`server not found: ${tool.serverId}`);
        }
      })
    );
    return c.json({ results: tools }, 200);
  });

  app.onError((err, c) => {
    console.error("[gateway] 500", c.req.method, c.req.path, err instanceof Error ? err.message : String(err));
    return c.json({ error: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "NOT_FOUND", message: "Not found" }, 404));

  return app;
}
