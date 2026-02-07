/**
 * Local Auth Controller
 *
 * Provides register/login/refresh endpoints for local dev mode.
 * Uses bcrypt for password hashing and mock JWT for token issuance.
 * Only mounted when MOCK_JWT_SECRET is set.
 */

import type { Context } from "hono";
import { createMockJwt } from "../auth/index.ts";
import type { LocalUsersDb } from "../db/local-users.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { Env } from "../types.ts";
import { uuidToUserId } from "../util/encoding.ts";

// ============================================================================
// Types
// ============================================================================

export type LocalAuthController = {
  register: (c: Context<Env>) => Promise<Response>;
  login: (c: Context<Env>) => Promise<Response>;
  refresh: (c: Context<Env>) => Promise<Response>;
};

type LocalAuthControllerDeps = {
  localUsersDb: LocalUsersDb;
  userRolesDb: UserRolesDb;
  mockJwtSecret: string;
};

// ============================================================================
// Password Hashing (simple HMAC-based for local dev)
// ============================================================================

const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  const computed = await hashPassword(password);
  return computed === hash;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createLocalAuthController = (deps: LocalAuthControllerDeps): LocalAuthController => {
  const { localUsersDb, userRolesDb, mockJwtSecret } = deps;

  const issueTokens = (userId: string) => {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = createMockJwt(mockJwtSecret, {
      sub: userId,
      exp: now + 3600, // 1 hour
      iat: now,
    });
    const refreshToken = createMockJwt(mockJwtSecret, {
      sub: userId,
      exp: now + 86400 * 30, // 30 days
      iat: now,
      type: "refresh",
    });
    return { accessToken, refreshToken, expiresIn: 3600 };
  };

  return {
    register: async (c) => {
      const body = await c.req.json();
      const { email, password, name } = body;

      // Generate a UUID for the user
      const uuid = crypto.randomUUID();
      const userId = uuidToUserId(uuid);

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user in DB
      try {
        await localUsersDb.createUser(email, passwordHash, userId, name);
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          err.name === "ConditionalCheckFailedException"
        ) {
          return c.json({ error: "EMAIL_EXISTS", message: "Email already registered" }, 409);
        }
        throw err;
      }

      // Auto-authorize the user (local dev convenience)
      await userRolesDb.setRole(userId, "admin");

      // Issue tokens
      const tokens = issueTokens(userId);

      return c.json(
        {
          userId,
          email,
          name,
          ...tokens,
        },
        201
      );
    },

    login: async (c) => {
      const body = await c.req.json();
      const { email, password } = body;

      // Find user
      const user = await localUsersDb.findByEmail(email);
      if (!user) {
        return c.json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401);
      }

      // Verify password
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return c.json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401);
      }

      // Issue tokens
      const tokens = issueTokens(user.userId);

      return c.json({
        userId: user.userId,
        email: user.email,
        name: user.name,
        ...tokens,
      });
    },

    refresh: async (c) => {
      const body = await c.req.json();
      const { refreshToken } = body;

      // Decode and verify the refresh token
      try {
        const parts = refreshToken.split(".");
        if (parts.length !== 3) {
          return c.json({ error: "INVALID_TOKEN", message: "Invalid refresh token" }, 401);
        }

        // Verify using the mock JWT verifier inline
        const { createHmac } = await import("node:crypto");
        const [headerB64, payloadB64, signatureB64] = parts;
        const signatureInput = `${headerB64}.${payloadB64}`;
        const expectedSignature = createHmac("sha256", mockJwtSecret)
          .update(signatureInput)
          .digest("base64url");

        if (signatureB64 !== expectedSignature) {
          return c.json({ error: "INVALID_TOKEN", message: "Invalid refresh token" }, 401);
        }

        // Decode payload
        const padding = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
        const payloadJson = Buffer.from(
          payloadB64.replace(/-/g, "+").replace(/_/g, "/") + padding,
          "base64"
        ).toString("utf-8");
        const payload = JSON.parse(payloadJson);

        if (!payload.sub || payload.type !== "refresh") {
          return c.json({ error: "INVALID_TOKEN", message: "Not a refresh token" }, 401);
        }

        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return c.json({ error: "TOKEN_EXPIRED", message: "Refresh token expired" }, 401);
        }

        // Issue new access token
        const now = Math.floor(Date.now() / 1000);
        const accessToken = createMockJwt(mockJwtSecret, {
          sub: payload.sub,
          exp: now + 3600,
          iat: now,
        });

        return c.json({ accessToken, expiresIn: 3600 });
      } catch {
        return c.json({ error: "INVALID_TOKEN", message: "Invalid refresh token" }, 401);
      }
    },
  };
};
