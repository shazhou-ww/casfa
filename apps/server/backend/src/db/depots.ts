/**
 * Depot database operations
 *
 * Depot stores data with a history stack for versioning.
 * Each user has a default "main" depot.
 *
 * Updated for DelegateToken refactor:
 * - New primary key format: pk=REALM#{realm}, sk=DEPOT#{depotId}
 * - Added creator tracking fields: creatorIssuerId, creatorTokenId
 * - Added GSI3 for querying by creator
 * - Renamed title to name (backward compatible alias maintained)
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DelegateTokenRecord, ListOptions, PaginatedResult } from "../types/delegate-token.ts";
import type { Depot } from "../types.ts";
import { decodeCursor, encodeCursor, toCreatorGsi3Pk, toDepotGsi3Sk } from "../util/db-keys.ts";
import { generateDepotId } from "../util/token-id.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Constants
// ============================================================================

export const MAIN_DEPOT_NAME = "main";
/** @deprecated Use MAIN_DEPOT_NAME instead */
export const MAIN_DEPOT_TITLE = MAIN_DEPOT_NAME;
export const DEFAULT_MAX_HISTORY = 20;
export const SYSTEM_MAX_HISTORY = 100;

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a new Depot
 */
export type CreateDepotOptions = {
  /** Depot name (displayed in API) */
  name: string;
  /** @deprecated Use name instead */
  title?: string;
  /** Initial root hash */
  root: string;
  /** Maximum history entries to keep */
  maxHistory?: number;
  /** Creator's issuer ID (required for new depots) */
  creatorIssuerId?: string;
  /** Creator's token ID (required for new depots) */
  creatorTokenId?: string;
};

/**
 * Options for updating a Depot
 */
export type UpdateDepotOptions = {
  /** New depot name */
  name?: string;
  /** @deprecated Use name instead */
  title?: string;
  /** New max history limit */
  maxHistory?: number;
};

/**
 * Extended Depot type with new fields
 */
export type ExtendedDepot = Depot & {
  /** Depot name (alias for title, for API consistency) */
  name?: string;
  /** Creator's issuer ID */
  creatorIssuerId?: string;
  /** Creator's token ID */
  creatorTokenId?: string;
};

export type DepotsDb = {
  /** Create a new depot */
  create: (realm: string, options: CreateDepotOptions) => Promise<ExtendedDepot>;

  /** Get a depot by ID */
  get: (realm: string, depotId: string) => Promise<ExtendedDepot | null>;

  /** Get a depot by name/title */
  getByName: (realm: string, name: string) => Promise<ExtendedDepot | null>;
  /** @deprecated Use getByName instead */
  getByTitle: (realm: string, title: string) => Promise<ExtendedDepot | null>;

  /** Update depot metadata */
  update: (
    realm: string,
    depotId: string,
    options: UpdateDepotOptions
  ) => Promise<ExtendedDepot | null>;

  /** Commit a new root version */
  commit: (realm: string, depotId: string, newRoot: string) => Promise<ExtendedDepot | null>;

  /** Delete a depot */
  delete: (realm: string, depotId: string) => Promise<boolean>;

  /** List all depots in a realm */
  list: (
    realm: string,
    options?: { limit?: number; startKey?: string }
  ) => Promise<{ depots: ExtendedDepot[]; nextKey?: string; hasMore: boolean }>;

  // New methods for DelegateToken support

  /** List depots by creator (using GSI3) */
  listByCreator: (
    creatorIssuerId: string,
    options?: ListOptions
  ) => Promise<PaginatedResult<ExtendedDepot>>;

  /** List depots visible to a token (based on issuerChain) */
  listVisibleToToken: (
    token: DelegateTokenRecord,
    realm: string,
    options?: ListOptions
  ) => Promise<PaginatedResult<ExtendedDepot>>;

  /** Check if a token can access a depot */
  checkAccess: (
    realm: string,
    depotId: string,
    tokenIssuerChain: string[],
    tokenIssuerId: string
  ) => Promise<boolean>;
};

type DepotsDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createDepotsDb = (config: DepotsDbConfig): DepotsDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  // Legacy key format for backward compatibility during migration
  const toLegacyDepotKey = (depotId: string) => `DEPOT#${depotId}`;

  /**
   * Convert record to ExtendedDepot for API compatibility
   */
  const toExtendedDepot = (item: Record<string, unknown>): ExtendedDepot => {
    const depot = item as ExtendedDepot;
    // Ensure name is set (may come from title in legacy records)
    if (!depot.name && depot.title) {
      depot.name = depot.title;
    }
    // Ensure title is set for backward compatibility
    if (!depot.title && depot.name) {
      depot.title = depot.name;
    }
    return depot;
  };

  const create = async (realm: string, options: CreateDepotOptions): Promise<ExtendedDepot> => {
    const depotId = generateDepotId();
    const now = Date.now();
    const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
    const name = options.name || options.title || "";

    const depot: ExtendedDepot = {
      realm,
      depotId,
      name,
      title: name, // Backward compatibility
      root: options.root,
      maxHistory,
      history: [],
      createdAt: now,
      updatedAt: now,
      creatorIssuerId: options.creatorIssuerId,
      creatorTokenId: options.creatorTokenId,
    };

    // Build the item with both old and new key formats during transition
    const item: Record<string, unknown> = {
      // Legacy keys (for backward compatibility with existing queries)
      key: toLegacyDepotKey(depotId),
      gsi1pk: `${realm}#DEPOT_TITLE`,
      gsi1sk: name,
      ...depot,
    };

    // Add GSI3 keys if creator info is provided
    if (options.creatorIssuerId) {
      item.gsi3pk = toCreatorGsi3Pk(options.creatorIssuerId);
      item.gsi3sk = toDepotGsi3Sk(depotId);
    }

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      })
    );

    return depot;
  };

  const get = async (realm: string, depotId: string): Promise<ExtendedDepot | null> => {
    // Normalize depotId (remove depot: prefix if present)
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;

    // Query using legacy key format
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: toLegacyDepotKey(rawId) },
      })
    );

    if (!result.Item) return null;
    return toExtendedDepot(result.Item);
  };

  const getByName = async (realm: string, name: string): Promise<ExtendedDepot | null> => {
    // Use list and filter (simpler, works without GSI issues in local DynamoDB)
    const result = await list(realm, { limit: 1000 });
    const depot = result.depots.find((d) => d.name === name || d.title === name);
    return depot ?? null;
  };

  // Backward compatibility alias
  const getByTitle = getByName;

  const update = async (
    realm: string,
    depotId: string,
    options: UpdateDepotOptions
  ): Promise<ExtendedDepot | null> => {
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;
    const now = Date.now();

    // Build update expression dynamically
    const updates: string[] = ["updatedAt = :now"];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ":now": now };

    const newName = options.name || options.title;
    if (newName !== undefined) {
      updates.push("#name = :name");
      updates.push("#title = :name"); // Keep title in sync
      updates.push("gsi1sk = :name"); // Update GSI
      names["#name"] = "name";
      names["#title"] = "title";
      values[":name"] = newName;
    }

    if (options.maxHistory !== undefined) {
      updates.push("maxHistory = :maxHistory");
      values[":maxHistory"] = options.maxHistory;
    }

    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { realm, key: toLegacyDepotKey(rawId) },
          UpdateExpression: `SET ${updates.join(", ")}`,
          ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
          ExpressionAttributeValues: values,
          ConditionExpression: "attribute_exists(realm)",
          ReturnValues: "ALL_NEW",
        })
      );

      const depot = toExtendedDepot(result.Attributes as Record<string, unknown>);

      // If maxHistory was reduced, truncate history
      if (options.maxHistory !== undefined && depot.history.length > options.maxHistory) {
        const truncatedHistory = depot.history.slice(0, options.maxHistory);
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { realm, key: toLegacyDepotKey(rawId) },
            UpdateExpression: "SET history = :history",
            ExpressionAttributeValues: { ":history": truncatedHistory },
          })
        );
        depot.history = truncatedHistory;
      }

      return depot;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") return null;
      throw error;
    }
  };

  const commit = async (
    realm: string,
    depotId: string,
    newRoot: string
  ): Promise<ExtendedDepot | null> => {
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;
    const now = Date.now();

    // Get current depot
    const current = await get(realm, rawId);
    if (!current) return null;

    const oldRoot = current.root;

    // Build new history: remove newRoot if exists, add oldRoot at front
    let newHistory = current.history.filter((h) => h !== newRoot);
    newHistory = [oldRoot, ...newHistory];

    // Truncate to maxHistory
    if (newHistory.length > current.maxHistory) {
      newHistory = newHistory.slice(0, current.maxHistory);
    }

    const result = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { realm, key: toLegacyDepotKey(rawId) },
        UpdateExpression: "SET #root = :root, history = :history, updatedAt = :now",
        ExpressionAttributeNames: { "#root": "root" },
        ExpressionAttributeValues: {
          ":root": newRoot,
          ":history": newHistory,
          ":now": now,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return toExtendedDepot(result.Attributes as Record<string, unknown>);
  };

  const deleteDepot = async (realm: string, depotId: string): Promise<boolean> => {
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;

    try {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { realm, key: toLegacyDepotKey(rawId) },
          ConditionExpression: "attribute_exists(realm)",
        })
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  };

  const list = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ depots: ExtendedDepot[]; nextKey?: string; hasMore: boolean }> => {
    const limit = options.limit ?? 100;

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: { "#key": "key" },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": "DEPOT#",
        },
        Limit: limit,
        ExclusiveStartKey: options.startKey
          ? { realm, key: toLegacyDepotKey(options.startKey) }
          : undefined,
      })
    );

    const depots = (result.Items ?? []).map((item) =>
      toExtendedDepot(item as Record<string, unknown>)
    );
    const lastKey = result.LastEvaluatedKey?.key as string | undefined;
    const nextKey = lastKey?.startsWith("DEPOT#") ? lastKey.slice(6) : lastKey;
    const hasMore = !!result.LastEvaluatedKey;

    return { depots, nextKey, hasMore };
  };

  // New methods for DelegateToken support

  const listByCreator = async (
    creatorIssuerId: string,
    options?: ListOptions
  ): Promise<PaginatedResult<ExtendedDepot>> => {
    const limit = options?.limit ?? 100;

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi3",
        KeyConditionExpression: "gsi3pk = :pk",
        ExpressionAttributeValues: {
          ":pk": toCreatorGsi3Pk(creatorIssuerId),
        },
        Limit: limit + 1,
        ExclusiveStartKey: options?.cursor ? decodeCursor(options.cursor) : undefined,
      })
    );

    const items = (result.Items ?? []).map((item) =>
      toExtendedDepot(item as Record<string, unknown>)
    );
    const hasMore = items.length > limit;
    const depots = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey) {
      nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return { items: depots, nextCursor, hasMore };
  };

  const listVisibleToToken = async (
    token: DelegateTokenRecord,
    realm: string,
    options?: ListOptions
  ): Promise<PaginatedResult<ExtendedDepot>> => {
    // Visible issuers = issuerChain + current token's issuerId
    const visibleIssuers = [...token.issuerChain, token.issuerId];

    // Query each issuer in parallel
    const results = await Promise.all(
      visibleIssuers.map((issuerId) =>
        client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: "gsi3",
            KeyConditionExpression: "gsi3pk = :pk",
            ExpressionAttributeValues: {
              ":pk": toCreatorGsi3Pk(issuerId),
            },
          })
        )
      )
    );

    // Collect and deduplicate depots
    const depotMap = new Map<string, ExtendedDepot>();
    for (const result of results) {
      for (const item of result.Items ?? []) {
        const depot = toExtendedDepot(item as Record<string, unknown>);
        // Filter by realm
        if (depot.realm === realm) {
          depotMap.set(depot.depotId, depot);
        }
      }
    }

    // Convert to array and apply pagination
    const allDepots = Array.from(depotMap.values());
    const limit = options?.limit ?? 100;

    // Simple pagination (not cursor-based for this aggregated query)
    const startIndex = 0; // Could be parsed from cursor if needed
    const paginatedDepots = allDepots.slice(startIndex, startIndex + limit);
    const hasMore = allDepots.length > startIndex + limit;

    return {
      items: paginatedDepots,
      nextCursor: hasMore ? encodeCursor({ offset: startIndex + limit }) : undefined,
      hasMore,
    };
  };

  const checkAccess = async (
    realm: string,
    depotId: string,
    tokenIssuerChain: string[],
    tokenIssuerId: string
  ): Promise<boolean> => {
    // Get the depot
    const depot = await get(realm, depotId);
    if (!depot) return false;

    // If no creator info, allow access (legacy depot)
    if (!depot.creatorIssuerId) return true;

    // Check if depot creator is in the visible issuers list
    const visibleIssuers = [...tokenIssuerChain, tokenIssuerId];
    return visibleIssuers.includes(depot.creatorIssuerId);
  };

  return {
    create,
    get,
    getByName,
    getByTitle,
    update,
    commit,
    delete: deleteDepot,
    list,
    listByCreator,
    listVisibleToToken,
    checkAccess,
  };
};
