/**
 * Authorization Codes DB
 *
 * Stores OAuth authorization codes in DynamoDB (tokensTable).
 * PK = AUTHCODE#{code}, SK = METADATA
 * TTL auto-cleanup via expiresAtTtl (DynamoDB TTL attribute).
 */

import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type GrantedPermissions = {
  canUpload: boolean;
  canManageDepot: boolean;
  delegatedDepots?: string[];
  scopeNodeHash?: string;
  expiresIn?: number;
};

export type AuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  userId: string;
  realm: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  grantedPermissions: GrantedPermissions;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

export type AuthCodesDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

export type AuthCodesDb = {
  /** Store a new authorization code. Fails if code already exists. */
  create: (authCode: AuthorizationCode) => Promise<void>;
  /** Get an authorization code by its code string. Returns null if not found. */
  get: (code: string) => Promise<AuthorizationCode | null>;
  /**
   * Atomically mark an authorization code as used.
   * Returns the full AuthorizationCode if successfully consumed,
   * or null if already used / not found / expired.
   * Uses DynamoDB conditional write to prevent double-spend.
   */
  consume: (code: string) => Promise<AuthorizationCode | null>;
};

// ============================================================================
// Factory
// ============================================================================

export const createAuthCodesDb = (config: AuthCodesDbConfig): AuthCodesDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const pk = (code: string) => `AUTHCODE#${code}`;
  const SK = "METADATA";

  const create = async (authCode: AuthorizationCode): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: pk(authCode.code),
          sk: SK,
          ...authCode,
          // DynamoDB TTL — auto-delete after expiration (seconds since epoch)
          expiresAtTtl: Math.floor(authCode.expiresAt / 1000),
        },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  };

  const get = async (code: string): Promise<AuthorizationCode | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: pk(code), sk: SK },
      }),
    );
    if (!result.Item) return null;
    return itemToAuthCode(result.Item);
  };

  const consume = async (code: string): Promise<AuthorizationCode | null> => {
    // First get the current item so we can return it
    const existing = await get(code);
    if (!existing) return null;
    if (existing.used) return null;
    if (existing.expiresAt < Date.now()) return null;

    // Atomic conditional update — prevents double-spend
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: pk(code), sk: SK },
          UpdateExpression: "SET used = :true, usedAt = :now",
          ConditionExpression: "attribute_exists(pk) AND used = :false",
          ExpressionAttributeValues: {
            ":true": true,
            ":false": false,
            ":now": Date.now(),
          },
        }),
      );
      return existing;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") return null;
      throw error;
    }
  };

  return { create, get, consume };
};

// ============================================================================
// Helpers
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: DynamoDB item mapping
const itemToAuthCode = (item: Record<string, any>): AuthorizationCode => ({
  code: item.code,
  clientId: item.clientId,
  redirectUri: item.redirectUri,
  userId: item.userId,
  realm: item.realm,
  scopes: item.scopes,
  codeChallenge: item.codeChallenge,
  codeChallengeMethod: item.codeChallengeMethod,
  grantedPermissions: item.grantedPermissions,
  createdAt: item.createdAt,
  expiresAt: item.expiresAt,
  used: item.used,
});
