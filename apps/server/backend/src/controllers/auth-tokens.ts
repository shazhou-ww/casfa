/**
 * Agent Token management controller
 */

import { CreateTokenSchema } from "@casfa/protocol";
import type { Context } from "hono";
import type { TokensDb } from "../db/tokens.ts";
import type { Env } from "../types.ts";
import { extractTokenId } from "../util/token-id.ts";

export type AuthTokensController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
};

type AuthTokensControllerDeps = {
  tokensDb: TokensDb;
};

export const createAuthTokensController = (
  deps: AuthTokensControllerDeps
): AuthTokensController => {
  const { tokensDb } = deps;

  return {
    create: async (c) => {
      const auth = c.get("auth");
      const { name, description, expiresIn } = CreateTokenSchema.parse(await c.req.json());

      const agentToken = await tokensDb.createAgentToken(auth.userId, name, {
        description,
        expiresIn,
      });

      const tokenId = extractTokenId(agentToken.pk);

      return c.json(
        {
          id: `token:${tokenId}`,
          token: `casfa_${tokenId}`,
          name: agentToken.name,
          description: agentToken.description,
          expiresAt: agentToken.expiresAt,
          createdAt: agentToken.createdAt,
        },
        201
      );
    },

    list: async (c) => {
      const auth = c.get("auth");
      const tokens = await tokensDb.listAgentTokensByUser(auth.userId);

      return c.json({
        tokens: tokens.map((t) => {
          const tokenId = extractTokenId(t.pk);
          return {
            id: `token:${tokenId}`,
            name: t.name,
            description: t.description,
            expiresAt: t.expiresAt,
            createdAt: t.createdAt,
          };
        }),
      });
    },

    revoke: async (c) => {
      const auth = c.get("auth");
      const rawTokenId = c.req.param("id");

      // Extract token ID from token:xxx format if present
      const tokenId = rawTokenId.startsWith("token:") ? rawTokenId.slice(6) : rawTokenId;

      try {
        await tokensDb.revokeAgentToken(auth.userId, tokenId);
        return c.json({ success: true });
      } catch (error: unknown) {
        const err = error as Error;
        return c.json({ error: err.message ?? "Token not found" }, 404);
      }
    },
  };
};
