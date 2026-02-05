/**
 * DelegateToken database operations
 *
 * Manages DelegateToken records including creation, retrieval, revocation,
 * and cascade revocation of child tokens.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type {
  DelegateTokenRecord,
  CreateDelegateTokenInput,
  ListOptions,
  PaginatedResult,
} from "../types/delegate-token.ts";
import {
  toTokenPk,
  toTokenSk,
  toRealmGsi1Pk,
  toTokenGsi1Sk,
  toIssuerGsi2Pk,
  toTokenGsi2Sk,
  toTtl,
  encodeCursor,
  decodeCursor,
} from "../util/db-keys.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type DelegateTokensDb = {
  /**
   * Create a new DelegateToken
   */
  create: (input: CreateDelegateTokenInput) => Promise<DelegateTokenRecord>;

  /**
   * Get a token by ID (returns null if not found)
   */
  get: (tokenId: string) => Promise<DelegateTokenRecord | null>;

  /**
   * Get a valid token by ID (filters out expired and revoked tokens)
   */
  getValid: (tokenId: string) => Promise<DelegateTokenRecord | null>;

  /**
   * Revoke a single token (does not cascade)
   */
  revoke: (tokenId: string, revokerId: string, reason?: string) => Promise<void>;

  /**
   * Revoke a token and all its descendants (cascade revocation)
   * Returns the total number of tokens revoked
   */
  revokeWithCascade: (tokenId: string, revokerId: string, reason?: string) => Promise<number>;

  /**
   * List tokens by realm
   */
  listByRealm: (
    realm: string,
    options?: ListOptions & { includeRevoked?: boolean }
  ) => Promise<PaginatedResult<DelegateTokenRecord>>;

  /**
   * List tokens by issuer (used for cascade revocation)
   */
  listByIssuer: (issuerId: string) => Promise<DelegateTokenRecord[]>;

  /**
   * Validate a token by checking its existence and status
   * Also checks if any ancestor in issuerChain is revoked
   */
  validateToken: (tokenId: string) => Promise<TokenValidationResult>;
};

export type TokenValidationResult =
  | { valid: true; token: DelegateTokenRecord }
  | { valid: false; reason: TokenInvalidReason; ancestorId?: string };

export type TokenInvalidReason =
  | "token_not_found"
  | "token_expired"
  | "token_revoked"
  | "ancestor_revoked";

type DelegateTokensDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createDelegateTokensDb = (config: DelegateTokensDbConfig): DelegateTokensDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const create = async (input: CreateDelegateTokenInput): Promise<DelegateTokenRecord> => {
    const now = Date.now();

    const record: DelegateTokenRecord = {
      // Primary key
      pk: toTokenPk(input.tokenId),
      sk: toTokenSk(),

      // Token fields from input
      ...input,

      // Status
      isRevoked: false,

      // Timestamps
      createdAt: now,

      // TTL
      ttl: toTtl(input.expiresAt),

      // GSI keys
      gsi1pk: toRealmGsi1Pk(input.realm),
      gsi1sk: toTokenGsi1Sk(input.tokenId),
      gsi2pk: toIssuerGsi2Pk(input.issuerId),
      gsi2sk: toTokenGsi2Sk(input.tokenId),
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );

    return record;
  };

  const get = async (tokenId: string): Promise<DelegateTokenRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toTokenPk(tokenId), sk: toTokenSk() },
      })
    );

    if (!result.Item) return null;
    return result.Item as DelegateTokenRecord;
  };

  const getValid = async (tokenId: string): Promise<DelegateTokenRecord | null> => {
    const token = await get(tokenId);
    if (!token) return null;
    if (token.isRevoked) return null;
    if (token.expiresAt < Date.now()) return null;
    return token;
  };

  const revoke = async (tokenId: string, revokerId: string, reason?: string): Promise<void> => {
    const now = Date.now();

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toTokenPk(tokenId), sk: toTokenSk() },
        UpdateExpression: "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
        ConditionExpression: "attribute_exists(pk) AND isRevoked = :false",
        ExpressionAttributeValues: {
          ":true": true,
          ":false": false,
          ":now": now,
          ":by": revokerId,
        },
      })
    );
  };

  const revokeWithCascade = async (
    tokenId: string,
    revokerId: string,
    reason?: string
  ): Promise<number> => {
    const now = Date.now();

    // Step 1: Revoke the target token first (atomic operation)
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toTokenPk(tokenId), sk: toTokenSk() },
          UpdateExpression: "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
          ConditionExpression: "isRevoked = :false",
          ExpressionAttributeValues: {
            ":true": true,
            ":false": false,
            ":now": now,
            ":by": revokerId,
          },
        })
      );
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Token already revoked or doesn't exist
        return 0;
      }
      throw error;
    }

    // Step 2: Collect all descendant tokens using BFS
    const childTokenIds = await collectAllChildren(tokenId);

    // Step 3: Revoke children in batches
    let revokedCount = 1; // Include the target token
    const batchSize = 25; // Smaller batches to reduce transaction conflicts

    for (let i = 0; i < childTokenIds.length; i += batchSize) {
      const batch = childTokenIds.slice(i, i + batchSize);

      try {
        const transactItems = batch.map((id) => ({
          Update: {
            TableName: tableName,
            Key: { pk: toTokenPk(id), sk: toTokenSk() },
            UpdateExpression: "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
            ExpressionAttributeValues: {
              ":true": true,
              ":now": now,
              ":by": `cascade:${tokenId}`,
            },
          },
        }));

        await client.send(
          new TransactWriteCommand({
            TransactItems: transactItems,
          } as TransactWriteCommandInput)
        );

        revokedCount += batch.length;
      } catch (error) {
        // Log error but continue - cascade revocation should be best effort
        // Security is maintained because validation checks issuerChain
        console.error(`Cascade revocation batch failed for tokens: ${batch.join(", ")}`);
      }
    }

    return revokedCount;
  };

  /**
   * Recursively collect all descendant token IDs using BFS
   */
  const collectAllChildren = async (tokenId: string): Promise<string[]> => {
    const allChildren: string[] = [];
    const queue: string[] = [tokenId];
    const visited = new Set<string>([tokenId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Query direct children using gsi2
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "gsi2",
          KeyConditionExpression: "gsi2pk = :pk",
          ExpressionAttributeValues: {
            ":pk": toIssuerGsi2Pk(current),
          },
          ProjectionExpression: "tokenId",
        })
      );

      for (const item of result.Items ?? []) {
        const childId = item.tokenId as string;
        if (!visited.has(childId)) {
          visited.add(childId);
          allChildren.push(childId);
          queue.push(childId);
        }
      }
    }

    return allChildren;
  };

  const listByRealm = async (
    realm: string,
    options?: ListOptions & { includeRevoked?: boolean }
  ): Promise<PaginatedResult<DelegateTokenRecord>> => {
    const limit = options?.limit ?? 100;
    const includeRevoked = options?.includeRevoked ?? false;

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
        FilterExpression: includeRevoked
          ? undefined
          : "isRevoked = :false AND expiresAt > :now",
        ExpressionAttributeValues: {
          ":pk": toRealmGsi1Pk(realm),
          ":prefix": "TOKEN#",
          ...(includeRevoked ? {} : { ":false": false, ":now": Date.now() }),
        },
        Limit: limit + 1,
        ExclusiveStartKey: options?.cursor ? decodeCursor(options.cursor) : undefined,
        ScanIndexForward: false,
      })
    );

    const items = (result.Items ?? []) as DelegateTokenRecord[];
    const hasMore = items.length > limit;
    const tokens = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey) {
      nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return { items: tokens, nextCursor, hasMore };
  };

  const listByIssuer = async (issuerId: string): Promise<DelegateTokenRecord[]> => {
    const items: DelegateTokenRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "gsi2",
          KeyConditionExpression: "gsi2pk = :pk",
          ExpressionAttributeValues: {
            ":pk": toIssuerGsi2Pk(issuerId),
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      items.push(...((result.Items ?? []) as DelegateTokenRecord[]));
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
  };

  const validateToken = async (tokenId: string): Promise<TokenValidationResult> => {
    // Get the token
    const token = await get(tokenId);
    if (!token) {
      return { valid: false, reason: "token_not_found" };
    }

    // Check if revoked
    if (token.isRevoked) {
      return { valid: false, reason: "token_revoked" };
    }

    // Check if expired
    if (token.expiresAt < Date.now()) {
      return { valid: false, reason: "token_expired" };
    }

    // Check if any ancestor in issuerChain is revoked
    // issuerChain[0] is typically the root user ID, so we start from index 1
    // for token IDs (those starting with "dlt1_")
    for (let i = 0; i < token.issuerChain.length; i++) {
      const ancestorId = token.issuerChain[i];
      // Check if this is a token ID (delegate tokens start with "dlt1_")
      if (ancestorId.startsWith("dlt1_")) {
        const ancestor = await get(ancestorId);
        if (ancestor?.isRevoked) {
          return { valid: false, reason: "ancestor_revoked", ancestorId };
        }
      }
    }

    return { valid: true, token };
  };

  return {
    create,
    get,
    getValid,
    revoke,
    revokeWithCascade,
    listByRealm,
    listByIssuer,
    validateToken,
  };
};
