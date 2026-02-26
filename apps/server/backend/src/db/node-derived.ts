/**
 * Node Derived Data — DynamoDB persistence layer
 *
 * Stores extension-generated derived data for CAS nodes.
 * CAS nodes are immutable → derived data keyed by storageKey never changes.
 *
 * Key schema (on tokensTable — pk/sk composite key):
 *   PK = NODE#{storageKey}
 *   SK = EXT#{extensionName}
 *
 * Since node content is globally unique (content-addressed), derived data
 * is NOT per-realm — the same storageKey always produces the same derived data.
 *
 * Lifecycle: derived data is cleaned up when the node is garbage-collected
 * (no realm references it anymore).
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

/** A single derived data record */
export type DerivedRecord = {
  /** Extension name (e.g., "meta", "thumbnail") */
  extension: string;
  /** Extension-defined payload (must be JSON-serializable, <400KB total) */
  data: Record<string, unknown>;
  /** When the derived data was generated (epoch ms) */
  createdAt: number;
};

export type NodeDerivedDb = {
  /**
   * Get derived data for a single node + extension.
   * Returns null when not found (triggers on-demand generation).
   */
  get: (storageKey: string, extension: string) => Promise<DerivedRecord | null>;

  /**
   * Store derived data for a node + extension.
   * Idempotent: re-generating overwrites silently.
   */
  put: (storageKey: string, extension: string, data: Record<string, unknown>) => Promise<void>;

  /**
   * Batch-get derived data for multiple nodes under the same extension.
   * Returns a Map<storageKey, DerivedRecord>. Missing keys are absent from the map.
   *
   * Callers are responsible for chunking; this function handles the
   * DynamoDB BatchGetItem 100-key limit internally.
   */
  batchGet: (storageKeys: string[], extension: string) => Promise<Map<string, DerivedRecord>>;

  /**
   * Delete all derived data for a node (all extensions).
   * Called during node GC.
   */
  deleteAll: (storageKey: string) => Promise<void>;
};

type NodeDerivedDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Key Helpers
// ============================================================================

const toNodePk = (storageKey: string): string => `NODE#${storageKey}`;
const toExtSk = (extension: string): string => `EXT#${extension}`;

// ============================================================================
// Factory
// ============================================================================

export const createNodeDerivedDb = (config: NodeDerivedDbConfig): NodeDerivedDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const get = async (storageKey: string, extension: string): Promise<DerivedRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: toNodePk(storageKey),
          sk: toExtSk(extension),
        },
      })
    );
    if (!result.Item) return null;
    return {
      extension,
      data: result.Item.data as Record<string, unknown>,
      createdAt: result.Item.createdAt as number,
    };
  };

  const put = async (
    storageKey: string,
    extension: string,
    data: Record<string, unknown>
  ): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: toNodePk(storageKey),
          sk: toExtSk(extension),
          data,
          createdAt: Date.now(),
        },
      })
    );
  };

  const batchGet = async (
    storageKeys: string[],
    extension: string
  ): Promise<Map<string, DerivedRecord>> => {
    const result = new Map<string, DerivedRecord>();
    if (storageKeys.length === 0) return result;

    // Deduplicate — DynamoDB BatchGetItem rejects duplicate keys
    const uniqueKeys = [...new Set(storageKeys)];

    // DynamoDB BatchGetItem supports max 100 keys per call
    const BATCH_SIZE = 100;
    for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
      const batch = uniqueKeys.slice(i, i + BATCH_SIZE);
      const keys = batch.map((key) => ({
        pk: toNodePk(key),
        sk: toExtSk(extension),
      }));

      const response = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: keys,
            },
          },
        })
      );

      const items = response.Responses?.[tableName] ?? [];
      for (const item of items) {
        // Extract storageKey from pk: "NODE#<storageKey>"
        const storageKey = (item.pk as string).slice(5);
        result.set(storageKey, {
          extension,
          data: item.data as Record<string, unknown>,
          createdAt: item.createdAt as number,
        });
      }

      // Handle unprocessed keys (retry once)
      const unprocessed = response.UnprocessedKeys?.[tableName]?.Keys;
      if (unprocessed && unprocessed.length > 0) {
        const retryResponse = await client.send(
          new BatchGetCommand({
            RequestItems: {
              [tableName]: { Keys: unprocessed },
            },
          })
        );
        const retryItems = retryResponse.Responses?.[tableName] ?? [];
        for (const item of retryItems) {
          const storageKey = (item.pk as string).slice(5);
          result.set(storageKey, {
            extension,
            data: item.data as Record<string, unknown>,
            createdAt: item.createdAt as number,
          });
        }
      }
    }

    return result;
  };

  const deleteAll = async (storageKey: string): Promise<void> => {
    // Query all extension records for this node
    const pk = toNodePk(storageKey);
    const queryResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":prefix": "EXT#",
        },
        ProjectionExpression: "sk",
      })
    );

    // Delete each extension record
    const items = queryResult.Items ?? [];
    for (const item of items) {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk, sk: item.sk },
        })
      );
    }
  };

  return { get, put, batchGet, deleteAll };
};
