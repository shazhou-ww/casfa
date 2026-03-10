/**
 * Local Auth Controller
 *
 * Provides register/login/refresh endpoints for local dev mode.
 * Uses bcrypt for password hashing and mock JWT for token issuance.
 * Only mounted when MOCK_JWT_SECRET is set.
 */

import type { Context } from "hono";
import { createMockJwt, createMockJwtVerifier } from "../auth/index.ts";
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

  /** Mock JWT verifier for refresh token verification */
  const mockVerifier = createMockJwtVerifier(mockJwtSecret);

  const issueTokens = async (userId: string) => {
    const now = Math.floor(Date.now() / 1000);
    const [accessToken, refreshToken] = await Promise.all([
      createMockJwt(mockJwtSecret, {
        sub: userId,
        exp: now + 3600, // 1 hour
        iat: now,
      }),
      createMockJwt(mockJwtSecret, {
        sub: userId,
        exp: now + 86400 * 30, // 30 days
        iat: now,
        type: "refresh",
      }),
    ]);
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
      const tokens = await issueTokens(userId);

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
      const tokens = await issueTokens(user.userId);

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

      // Verify refresh token using @casfa/oauth-consumer's mock verifier
      const result = await mockVerifier(refreshToken);
      if (!result.ok) {
        return c.json({ error: "INVALID_TOKEN", message: "Invalid refresh token" }, 401);
      }

      // Verify it's a refresh token (has type: "refresh" claim)
      const claims = result.value.rawClaims;
      if (claims.type !== "refresh") {
        return c.json({ error: "INVALID_TOKEN", message: "Not a refresh token" }, 401);
      }

      // Issue new access token
      const now = Math.floor(Date.now() / 1000);
      const accessToken = await createMockJwt(mockJwtSecret, {
        sub: result.value.subject,
        exp: now + 3600,
        iat: now,
      });

      return c.json({ accessToken, expiresIn: 3600 });
    },
  };
};
