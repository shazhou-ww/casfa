/**
 * OAuth controller
 */

import { LoginSchema, RefreshSchema, TokenExchangeSchema } from "@casfa/protocol";
import type { Context } from "hono";
import type { CognitoConfig } from "../config.ts";
import type { AuthService } from "../services/auth.ts";
import type { Env } from "../types.ts";

export type OAuthController = {
  getConfig: (c: Context) => Response;
  login: (c: Context) => Promise<Response>;
  refresh: (c: Context) => Promise<Response>;
  exchangeToken: (c: Context) => Promise<Response>;
  me: (c: Context<Env>) => Response;
};

type OAuthControllerDeps = {
  cognitoConfig: CognitoConfig;
  authService: AuthService;
};

export const createOAuthController = (deps: OAuthControllerDeps): OAuthController => {
  const { cognitoConfig, authService } = deps;

  return {
    getConfig: (c) => {
      // Extract domain from hostedUiUrl (e.g., "https://xxx.auth.us-east-1.amazoncognito.com" -> "xxx.auth.us-east-1.amazoncognito.com")
      let domain = cognitoConfig.hostedUiUrl;
      if (domain.startsWith("https://")) {
        domain = domain.slice(8);
      } else if (domain.startsWith("http://")) {
        domain = domain.slice(7);
      }

      return c.json({
        userPoolId: cognitoConfig.userPoolId,
        clientId: cognitoConfig.clientId,
        domain,
        region: cognitoConfig.region,
      });
    },

    login: async (c) => {
      const { email, password } = LoginSchema.parse(await c.req.json());
      const result = await authService.login(email, password);

      if (!result.ok) {
        return c.json({ error: result.error }, 401);
      }

      return c.json(result.value);
    },

    refresh: async (c) => {
      const { refreshToken } = RefreshSchema.parse(await c.req.json());
      const result = await authService.refresh(refreshToken);

      if (!result.ok) {
        return c.json({ error: result.error }, 401);
      }

      return c.json(result.value);
    },

    exchangeToken: async (c) => {
      const { code, redirect_uri, code_verifier } = TokenExchangeSchema.parse(await c.req.json());

      if (!cognitoConfig.hostedUiUrl || !cognitoConfig.clientId) {
        return c.json({ error: "OAuth not configured" }, 503);
      }

      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cognitoConfig.clientId,
        code,
        redirect_uri,
      });

      // Add PKCE code_verifier if provided (required for public clients)
      if (code_verifier) {
        tokenBody.set("code_verifier", code_verifier);
      }

      const tokenRes = await fetch(`${cognitoConfig.hostedUiUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });

      const text = await tokenRes.text();
      if (!tokenRes.ok) {
        return c.json({ error: "Token exchange failed", details: text }, tokenRes.status as 400);
      }

      try {
        const data = JSON.parse(text);
        return c.json(data);
      } catch {
        return c.json({ error: "Invalid token response" }, 502);
      }
    },

    me: (c) => {
      const auth = c.get("auth");
      return c.json({
        userId: auth.userId,
        email: auth.email,
        name: auth.name,
        realm: auth.realm,
        role: auth.role ?? "unauthorized",
      });
    },
  };
};
