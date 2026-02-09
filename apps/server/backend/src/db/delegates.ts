/**
 * Delegate database operations
 *
 * Manages Delegate entity records in DynamoDB.
 * Delegates are first-class authorization entities in the delegate tree.
 *
 * Table: casRealmTable (realm/key schema)
 *   PK (realm) = realm
 *   SK (key)   = DLG#{delegateId}
 *
 * GSI1 (parent-index):
 *   gsi1pk = PARENT#{parentId}   (or PARENT#ROOT for root delegates)
 *   gsi1sk = DLG#{delegateId}
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Delegate } from "@casfa/delegate";
import { createDocClient } from "./client.ts";

// ============================================================================
// Key Helpers
// ============================================================================

/** Sort key for a delegate record */
const toDelegateSk = (delegateId: string): string => `DLG#${delegateId}`;

/** Extract delegateId from sort key */
const extractDelegateId = (sk: string): string => {
  if (sk.startsWith("DLG#")) return sk.slice(4);
  return sk;
};

/** GSI1 partition key for parent-index */
const toParentGsi1Pk = (parentId: string | null): string =>
  parentId ? `PARENT#${parentId}` : "PARENT#ROOT";

/** GSI1 sort key for parent-index */
const toDelegateGsi1Sk = (delegateId: string): string => `DLG#${delegateId}`;

// ============================================================================
// Types
// ============================================================================

export type DelegatesDb = {
  /** Create a new delegate record */
  create: (delegate: Delegate) => Promise<void>;

  /** Get a delegate by realm + delegateId */
  get: (realm: string, delegateId: string) => Promise<Delegate | null>;

  /** Revoke a delegate (set isRevoked=true, revokedAt, revokedBy) */
  revoke: (
    realm: string,
    delegateId: string,
    revokedBy: string,
  ) => Promise<boolean>;

  /** List direct children of a delegate */
  listChildren: (
    parentId: string,
    options?: { limit?: number; cursor?: string },
  ) => Promise<{
    delegates: Delegate[];
    nextCursor?: string;
  }>;

  /**
   * Get or create the root delegate for a realm/user.
   * Root delegate: depth=0, parentId=null, canUpload=true, canManageDepot=true.
   * Uses conditional PutItem to handle race conditions.
   *
   * @param realm - The realm (= userId)
   * @param delegateId - Pre-generated delegate ID for the root
   * @returns The root delegate (either newly created or existing)
   */
  getOrCreateRoot: (
    realm: string,
    delegateId: string,
  ) => Promise<Delegate>;
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
    };
  };

  // --------------------------------------------------------------------------
  // Operations
  // --------------------------------------------------------------------------

  const create = async (delegate: Delegate): Promise<void> => {
    const item: Record<string, unknown> = {
      // DynamoDB keys
      realm: delegate.realm,
      key: toDelegateSk(delegate.delegateId),

      // GSI1 — parent-index
      gsi1pk: toParentGsi1Pk(delegate.parentId),
      gsi1sk: toDelegateGsi1Sk(delegate.delegateId),

      // Entity data
      delegateId: delegate.delegateId,
      ...(delegate.name !== undefined && { name: delegate.name }),
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
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        // Prevent overwriting existing delegate
        ConditionExpression:
          "attribute_not_exists(#realm) AND attribute_not_exists(#key)",
        ExpressionAttributeNames: { "#realm": "realm", "#key": "key" },
      }),
    );
  };

  const get = async (
    realm: string,
    delegateId: string,
  ): Promise<Delegate | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: toDelegateSk(delegateId) },
      }),
    );
    if (!result.Item) return null;
    return toDelegate(result.Item);
  };

  const revoke = async (
    realm: string,
    delegateId: string,
    revokedBy: string,
  ): Promise<boolean> => {
    const now = Date.now();
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { realm, key: toDelegateSk(delegateId) },
          UpdateExpression:
            "SET isRevoked = :true, revokedAt = :now, revokedBy = :by",
          ConditionExpression:
            "attribute_exists(#realm) AND isRevoked = :false",
          ExpressionAttributeNames: { "#realm": "realm" },
          ExpressionAttributeValues: {
            ":true": true,
            ":false": false,
            ":now": now,
            ":by": revokedBy,
          },
        }),
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Already revoked or doesn't exist
        return false;
      }
      throw error;
    }
  };

  const listChildren = async (
    parentId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ delegates: Delegate[]; nextCursor?: string }> => {
    const limit = options?.limit ?? 100;

    const params: Record<string, unknown> = {
      TableName: tableName,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": toParentGsi1Pk(parentId),
        ":prefix": "DLG#",
      },
      Limit: limit,
    };

    if (options?.cursor) {
      (params as Record<string, unknown>).ExclusiveStartKey = JSON.parse(
        Buffer.from(options.cursor, "base64").toString(),
      );
    }

    const result = await client.send(new QueryCommand(params as never));

    const delegates = (result.Items ?? []).map((item) =>
      toDelegate(item as Record<string, unknown>),
    );

    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      nextCursor = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString("base64");
    }

    return { delegates, nextCursor };
  };

  const getOrCreateRoot = async (
    realm: string,
    delegateId: string,
  ): Promise<Delegate> => {
    // Try to find existing root delegate by querying the parent-index
    // Root delegates have gsi1pk = "PARENT#ROOT"
    const queryResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: {
          ":pk": "PARENT#ROOT",
          ":realm": realm,
        },
        // Filter by realm since GSI doesn't include realm in the key
        FilterExpression: "#realm = :realm",
        ExpressionAttributeNames: { "#realm": "realm" },
        Limit: 1,
      }),
    );

    if (queryResult.Items && queryResult.Items.length > 0) {
      return toDelegate(queryResult.Items[0] as Record<string, unknown>);
    }

    // Create new root delegate
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
    };

    try {
      await create(rootDelegate);
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Race condition — another request created the root. Fetch it.
        const existing = await get(realm, delegateId);
        if (existing) return existing;
        // If not found by this ID, someone used a different ID. Query again.
        const retryResult = await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: "gsi1",
            KeyConditionExpression: "gsi1pk = :pk",
            ExpressionAttributeValues: {
              ":pk": "PARENT#ROOT",
              ":realm": realm,
            },
            FilterExpression: "#realm = :realm",
            ExpressionAttributeNames: { "#realm": "realm" },
            Limit: 1,
          }),
        );
        if (retryResult.Items && retryResult.Items.length > 0) {
          return toDelegate(retryResult.Items[0] as Record<string, unknown>);
        }
      }
      throw error;
    }

    return rootDelegate;
  };

  return { create, get, revoke, listChildren, getOrCreateRoot };
};
