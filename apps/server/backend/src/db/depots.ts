/**
 * Depot database operations
 *
 * Depot stores data with a history stack for versioning.
 * Each user has a default "main" depot.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Depot } from "../types.ts";
import { generateDepotId } from "../util/token-id.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Constants
// ============================================================================

export const MAIN_DEPOT_TITLE = "main";
export const DEFAULT_MAX_HISTORY = 20;
export const SYSTEM_MAX_HISTORY = 100;

// ============================================================================
// Types
// ============================================================================

export type CreateDepotOptions = {
  title: string;
  root: string;
  maxHistory?: number;
};

export type UpdateDepotOptions = {
  title?: string;
  maxHistory?: number;
};

export type DepotsDb = {
  create: (realm: string, options: CreateDepotOptions) => Promise<Depot>;
  get: (realm: string, depotId: string) => Promise<Depot | null>;
  getByTitle: (realm: string, title: string) => Promise<Depot | null>;
  update: (realm: string, depotId: string, options: UpdateDepotOptions) => Promise<Depot | null>;
  commit: (realm: string, depotId: string, newRoot: string) => Promise<Depot | null>;
  delete: (realm: string, depotId: string) => Promise<boolean>;
  list: (
    realm: string,
    options?: { limit?: number; startKey?: string }
  ) => Promise<{ depots: Depot[]; nextKey?: string; hasMore: boolean }>;
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

  const toDepotKey = (depotId: string) => `DEPOT#${depotId}`;

  const create = async (realm: string, options: CreateDepotOptions): Promise<Depot> => {
    const depotId = generateDepotId();
    const now = Date.now();
    const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;

    const depot: Depot = {
      realm,
      depotId,
      title: options.title,
      root: options.root,
      maxHistory,
      history: [],
      createdAt: now,
      updatedAt: now,
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          key: toDepotKey(depotId),
          gsi1pk: `${realm}#DEPOT_TITLE`,
          gsi1sk: options.title,
          ...depot,
        },
      })
    );

    return depot;
  };

  const get = async (realm: string, depotId: string): Promise<Depot | null> => {
    // Normalize depotId (remove depot: prefix if present)
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;

    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: toDepotKey(rawId) },
      })
    );
    if (!result.Item) return null;
    return result.Item as Depot;
  };

  const getByTitle = async (realm: string, title: string): Promise<Depot | null> => {
    // Use list and filter (simpler, works without GSI issues in local DynamoDB)
    const result = await list(realm, { limit: 1000 });
    const depot = result.depots.find((d) => d.title === title);
    return depot ?? null;
  };

  const update = async (
    realm: string,
    depotId: string,
    options: UpdateDepotOptions
  ): Promise<Depot | null> => {
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;
    const now = Date.now();

    // Build update expression dynamically
    const updates: string[] = ["updatedAt = :now"];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ":now": now };

    if (options.title !== undefined) {
      updates.push("#title = :title");
      names["#title"] = "title";
      values[":title"] = options.title;
    }

    if (options.maxHistory !== undefined) {
      updates.push("maxHistory = :maxHistory");
      values[":maxHistory"] = options.maxHistory;
    }

    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { realm, key: toDepotKey(rawId) },
          UpdateExpression: `SET ${updates.join(", ")}`,
          ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
          ExpressionAttributeValues: values,
          ConditionExpression: "attribute_exists(realm)",
          ReturnValues: "ALL_NEW",
        })
      );

      const depot = result.Attributes as Depot;

      // If maxHistory was reduced, truncate history
      if (options.maxHistory !== undefined && depot.history.length > options.maxHistory) {
        const truncatedHistory = depot.history.slice(0, options.maxHistory);
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { realm, key: toDepotKey(rawId) },
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

  const commit = async (realm: string, depotId: string, newRoot: string): Promise<Depot | null> => {
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
        Key: { realm, key: toDepotKey(rawId) },
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

    return result.Attributes as Depot;
  };

  const deleteDepot = async (realm: string, depotId: string): Promise<boolean> => {
    const rawId = depotId.startsWith("depot:") ? depotId.slice(6) : depotId;

    try {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { realm, key: toDepotKey(rawId) },
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
  ): Promise<{ depots: Depot[]; nextKey?: string; hasMore: boolean }> => {
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
          ? { realm, key: toDepotKey(options.startKey) }
          : undefined,
      })
    );

    const depots = (result.Items ?? []) as Depot[];
    const lastKey = result.LastEvaluatedKey?.key as string | undefined;
    const nextKey = lastKey?.startsWith("DEPOT#") ? lastKey.slice(6) : lastKey;
    const hasMore = !!result.LastEvaluatedKey;

    return { depots, nextKey, hasMore };
  };

  return {
    create,
    get,
    getByTitle,
    update,
    commit,
    delete: deleteDepot,
    list,
  };
};
