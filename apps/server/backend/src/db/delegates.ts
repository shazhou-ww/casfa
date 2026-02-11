/**
 * Delegate database operations
 *
 * Manages Delegate entity records in DynamoDB.
 * Delegates are first-class authorization entities in the delegate tree.
 *
 * Table: tokensTable (pk/sk schema — token-simplification v3)
 *   PK (pk) = DLG#{delegateId}
 *   SK (sk) = METADATA
 *
 * GSI1 (realm-index):
 *   gsi1pk = REALM#{realm}
 *   gsi1sk = DLG#{delegateId}
 *
 * GSI2 (parent-index):
 *   gsi2pk = PARENT#{parentId}   (or PARENT#ROOT for root delegates)
 *   gsi2sk = DLG#{delegateId}
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Delegate } from "@casfa/delegate";
import { createDocClient } from "./client.ts";

// ============================================================================
// Key Helpers
// ============================================================================

/** Partition key for a delegate record */
const toDelegatePk = (delegateId: string): string => `DLG#${delegateId}`;

/** Sort key for delegate metadata */
const METADATA_SK = "METADATA";

/** GSI1 partition key for realm-index */
const toRealmGsi1Pk = (realm: string): string => `REALM#${realm}`;

/** GSI1/GSI2 sort key for delegates */
const toDelegateGsiSk = (delegateId: string): string => `DLG#${delegateId}`;

/** GSI2 partition key for parent-index */
const toParentGsi2Pk = (parentId: string | null): string =>
  parentId ? `PARENT#${parentId}` : "PARENT#ROOT";

// ============================================================================
// Types
// ============================================================================

export type DelegatesDb = {
  /** Create a new delegate record (including initial token hashes) */
  create: (delegate: Delegate) => Promise<void>;

  /** Get a delegate by delegateId (primary key lookup — no realm needed) */
  get: (delegateId: string) => Promise<Delegate | null>;

  /** Revoke a delegate (set isRevoked=true, revokedAt, revokedBy) */
  revoke: (delegateId: string, revokedBy: string) => Promise<boolean>;

  /** List direct children of a delegate */
  listChildren: (
    parentId: string,
    options?: { limit?: number; cursor?: string }
  ) => Promise<{
    delegates: Delegate[];
    nextCursor?: string;
  }>;

  /**
   * Atomically rotate tokens on a delegate.
   * Uses conditional update: currentRtHash must match expectedRtHash.
   * Returns true on success, false if condition failed (replay or revoked).
   */
  rotateTokens: (params: {
    delegateId: string;
    expectedRtHash: string;
    newRtHash: string;
    newAtHash: string;
    newAtExpiresAt: number;
  }) => Promise<boolean>;

  /**
   * Get or create the root delegate for a realm/user.
   * Root delegate: depth=0, parentId=null, canUpload=true, canManageDepot=true.
   * Uses conditional PutItem to handle race conditions.
   *
   * @param realm - The realm (= userId)
   * @param delegateId - Pre-generated delegate ID for the root
   * @param tokenHashes - Initial token hashes for the root delegate
   * @returns The root delegate (either newly created or existing)
   */
  getOrCreateRoot: (
    realm: string,
    delegateId: string,
    tokenHashes: { currentRtHash: string; currentAtHash: string; atExpiresAt: number }
  ) => Promise<{ delegate: Delegate; created: boolean }>;

  /**
   * Find the root delegate for a realm (if it exists).
   * Uses GSI1 (realm-index) scoped to the correct realm.
   */
  getRootByRealm: (realm: string) => Promise<Delegate | null>;
};

type DelegatesDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createDelegatesDb = (config: DelegatesDbConfig): DelegatesDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Parse a DynamoDB item into a Delegate */
  const toDelegate = (item: Record<string, unknown>): Delegate => {
    return {
      delegateId: item.delegateId as string,
      name: item.name as string | undefined,
      realm: item.realm as string,
      parentId: (item.parentId as string | null) ?? null,
      chain: item.chain as string[],
      depth: item.depth as number,
      canUpload: item.canUpload as boolean,
      canManageDepot: item.canManageDepot as boolean,
      delegatedDepots: item.delegatedDepots as string[] | undefined,
      scopeNodeHash: item.scopeNodeHash as string | undefined,
      scopeSetNodeId: item.scopeSetNodeId as string | undefined,
      expiresAt: item.expiresAt as number | undefined,
      isRevoked: (item.isRevoked as boolean) ?? false,
      revokedAt: item.revokedAt as number | undefined,
      revokedBy: item.revokedBy as string | undefined,
      createdAt: item.createdAt as number,
      // Token hash fields
      currentRtHash: item.currentRtHash as string,
      currentAtHash: item.currentAtHash as string,
      atExpiresAt: item.atExpiresAt as number,
    };
  };

  // --------------------------------------------------------------------------
  // Operations
  // --------------------------------------------------------------------------

  const create = async (delegate: Delegate): Promise<void> => {
    const item: Record<string, unknown> = {
      // DynamoDB keys — new PK scheme: DLG#{delegateId} / METADATA
      pk: toDelegatePk(delegate.delegateId),
      sk: METADATA_SK,

      // GSI1 — realm-index
      gsi1pk: toRealmGsi1Pk(delegate.realm),
      gsi1sk: toDelegateGsiSk(delegate.delegateId),

      // GSI2 — parent-index
      gsi2pk: toParentGsi2Pk(delegate.parentId),
      gsi2sk: toDelegateGsiSk(delegate.delegateId),

      // Entity data
      delegateId: delegate.delegateId,
      ...(delegate.name !== undefined && { name: delegate.name }),
      realm: delegate.realm,
      parentId: delegate.parentId,
      chain: delegate.chain,
      depth: delegate.depth,
      canUpload: delegate.canUpload,
      canManageDepot: delegate.canManageDepot,
      ...(delegate.delegatedDepots !== undefined && {
        delegatedDepots: delegate.delegatedDepots,
      }),
      ...(delegate.scopeNodeHash !== undefined && {
        scopeNodeHash: delegate.scopeNodeHash,
      }),
      ...(delegate.scopeSetNodeId !== undefined && {
        scopeSetNodeId: delegate.scopeSetNodeId,
      }),
      ...(delegate.expiresAt !== undefined && {
        expiresAt: delegate.expiresAt,
      }),
      isRevoked: delegate.isRevoked,
      createdAt: delegate.createdAt,

      // Token hash fields
      currentRtHash: delegate.currentRtHash,
      currentAtHash: delegate.currentAtHash,
      atExpiresAt: delegate.atExpiresAt,
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        // Prevent overwriting existing delegate
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  };

  const get = async (delegateId: string): Promise<Delegate | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toDelegatePk(delegateId), sk: METADATA_SK },
      })
    );
    if (!result.Item) return null;
    return toDelegate(result.Item);
  };

  const revoke = async (delegateId: string, revokedBy: string): Promise<boolean> => {
    const now = Date.now();
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toDelegatePk(delegateId), sk: METADATA_SK },
          UpdateExpression: "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
          ConditionExpression: "attribute_exists(pk) AND isRevoked = :false",
          ExpressionAttributeValues: {
            ":true": true,
            ":false": false,
            ":now": now,
            ":by": revokedBy,
          },
        })
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        return false;
      }
      throw error;
    }
  };

  const listChildren = async (
    parentId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<{ delegates: Delegate[]; nextCursor?: string }> => {
    const limit = options?.limit ?? 100;

    const params: Record<string, unknown> = {
      TableName: tableName,
      IndexName: "gsi2",
      KeyConditionExpression: "gsi2pk = :pk AND begins_with(gsi2sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": toParentGsi2Pk(parentId),
        ":prefix": "DLG#",
      },
      Limit: limit,
    };

    if (options?.cursor) {
      (params as Record<string, unknown>).ExclusiveStartKey = JSON.parse(
        Buffer.from(options.cursor, "base64").toString()
      );
    }

    const result = await client.send(new QueryCommand(params as never));

    const delegates = (result.Items ?? []).map((item) =>
      toDelegate(item as Record<string, unknown>)
    );

    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64");
    }

    return { delegates, nextCursor };
  };

  const rotateTokens = async (params: {
    delegateId: string;
    expectedRtHash: string;
    newRtHash: string;
    newAtHash: string;
    newAtExpiresAt: number;
  }): Promise<boolean> => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toDelegatePk(params.delegateId), sk: METADATA_SK },
          UpdateExpression:
            "SET currentRtHash = :newRt, currentAtHash = :newAt, atExpiresAt = :newExp",
          ConditionExpression:
            "attribute_exists(pk) AND currentRtHash = :expectedRt AND isRevoked = :false",
          ExpressionAttributeValues: {
            ":newRt": params.newRtHash,
            ":newAt": params.newAtHash,
            ":newExp": params.newAtExpiresAt,
            ":expectedRt": params.expectedRtHash,
            ":false": false,
          },
        })
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        return false;
      }
      throw error;
    }
  };

  /**
   * Find the root delegate for a realm using GSI1 (realm-index).
   * Queries within the realm and filters for depth=0 (root).
   */
  const getRootByRealm = async (realm: string): Promise<Delegate | null> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeNames: {
          "#depth": "depth",
        },
        ExpressionAttributeValues: {
          ":pk": toRealmGsi1Pk(realm),
          ":zero": 0,
        },
        FilterExpression: "#depth = :zero",
      })
    );
    if (result.Items && result.Items.length > 0) {
      return toDelegate(result.Items[0] as Record<string, unknown>);
    }
    return null;
  };

  const getOrCreateRoot = async (
    realm: string,
    delegateId: string,
    tokenHashes: { currentRtHash: string; currentAtHash: string; atExpiresAt: number }
  ): Promise<{ delegate: Delegate; created: boolean }> => {
    // Try to find existing root delegate using realm-scoped index
    const existing = await getRootByRealm(realm);
    if (existing) {
      return { delegate: existing, created: false };
    }

    // Create new root delegate with token hashes
    const now = Date.now();
    const rootDelegate: Delegate = {
      delegateId,
      realm,
      parentId: null,
      chain: [delegateId],
      depth: 0,
      canUpload: true,
      canManageDepot: true,
      isRevoked: false,
      createdAt: now,
      currentRtHash: tokenHashes.currentRtHash,
      currentAtHash: tokenHashes.currentAtHash,
      atExpiresAt: tokenHashes.atExpiresAt,
    };

    try {
      await create(rootDelegate);
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Race condition — another request created the root. Find it.
        const retryRoot = await getRootByRealm(realm);
        if (retryRoot) {
          return { delegate: retryRoot, created: false };
        }
      }
      throw error;
    }

    return { delegate: rootDelegate, created: true };
  };

  return { create, get, revoke, listChildren, rotateTokens, getOrCreateRoot, getRootByRealm };
};
