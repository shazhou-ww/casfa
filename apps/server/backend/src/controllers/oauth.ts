/**
 * OAuth controller
 */

import { LoginSchema, RefreshSchema, TokenExchangeSchema } from "@casfa/protocol";
import type { Context } from "hono";
import type { CognitoConfig } from "../config.ts";
import type { Env, JwtAuthContext } from "../types.ts";

export type OAuthController = {
  getConfig: (c: Context) => Response;
  login: (c: Context) => Promise<Response>;
  refresh: (c: Context) => Promise<Response>;
  exchangeToken: (c: Context) => Promise<Response>;
  me: (c: Context<Env>) => Response;
};

type OAuthControllerDeps = {
  cognitoConfig: CognitoConfig;
};

export const createOAuthController = (deps: OAuthControllerDeps): OAuthController => {
  const { cognitoConfig } = deps;

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
      const body = LoginSchema.parse(await c.req.json());

      // Direct Cognito authentication using USER_PASSWORD_AUTH flow
      const authUrl = `https://cognito-idp.${cognitoConfig.region}.amazonaws.com`;
      const response = await fetch(authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        },
        body: JSON.stringify({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: cognitoConfig.clientId,
          AuthParameters: {
            USERNAME: body.email,
            PASSWORD: body.password,
          },
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        return c.json({ error: error.message || "Authentication failed" }, 401);
      }

      const result = (await response.json()) as {
        AuthenticationResult?: {
          AccessToken: string;
          IdToken: string;
          RefreshToken?: string;
          ExpiresIn: number;
        };
      };
      if (!result.AuthenticationResult) {
        return c.json({ error: "Authentication incomplete" }, 401);
      }

      return c.json({
        accessToken: result.AuthenticationResult.AccessToken,
        idToken: result.AuthenticationResult.IdToken,
        refreshToken: result.AuthenticationResult.RefreshToken,
        expiresIn: result.AuthenticationResult.ExpiresIn,
      });
    },

    refresh: async (c) => {
      const { refreshToken } = RefreshSchema.parse(await c.req.json());

      // Direct Cognito token refresh
      const authUrl = `https://cognito-idp.${cognitoConfig.region}.amazonaws.com`;
      const response = await fetch(authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        },
        body: JSON.stringify({
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: cognitoConfig.clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
          },
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        return c.json({ error: error.message || "Token refresh failed" }, 401);
      }

      const result = (await response.json()) as {
        AuthenticationResult?: {
          AccessToken: string;
          IdToken: string;
          ExpiresIn: number;
        };
      };
      if (!result.AuthenticationResult) {
        return c.json({ error: "Token refresh incomplete" }, 401);
      }

      return c.json({
        accessToken: result.AuthenticationResult.AccessToken,
        idToken: result.AuthenticationResult.IdToken,
        expiresIn: result.AuthenticationResult.ExpiresIn,
      });
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
        const data = JSON.parse(text) as {
          access_token: string;
          id_token?: string;
          refresh_token?: string;
          expires_in: number;
          token_type: string;
        };
        // Map Cognito OAuth2 snake_case response to camelCase
        // (consistent with login and refresh endpoints)
        return c.json({
          accessToken: data.access_token,
          idToken: data.id_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        });
      } catch {
        return c.json({ error: "Invalid token response" }, 502);
      }
    },

    me: (c) => {
      // This endpoint requires JWT auth, so we can safely cast
      const auth = c.get("auth") as JwtAuthContext;
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
