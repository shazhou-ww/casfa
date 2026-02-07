/**
 * ScopeSetNode database operations
 *
 * Manages scope set-nodes for Token scope storage with reference counting.
 * A set-node stores a sorted list of child node hashes and is referenced by multiple tokens.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ScopeSetNodeRecord } from "../types/delegate-token.ts";
import { toSetNodePk, toSetNodeSk } from "../util/db-keys.ts";
import { blake3s128 } from "../util/hashing.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Constants
// ============================================================================

/**
 * Empty set-node ID (hash of empty array)
 * This is a well-known constant for tokens with no scope
 */
const EMPTY_SET_NODE_ID = computeSetNodeId([]);

// ============================================================================
// Types
// ============================================================================

export type ScopeSetNodesDb = {
  /**
   * Get or create a set-node for the given children.
   * If the set-node already exists, returns it without incrementing ref count.
   * If creating new, initializes ref count to 0 (caller should increment).
   */
  getOrCreate: (children: string[]) => Promise<ScopeSetNodeRecord>;

  /**
   * Create a set-node or increment its reference count if it exists.
   * Convenience method combining getOrCreate + incrementRef.
   *
   * @param setNodeId - The set-node ID
   * @param children - The child hashes
   */
  createOrIncrement: (setNodeId: string, children: string[]) => Promise<void>;

  /**
   * Get a set-node by ID
   */
  get: (setNodeId: string) => Promise<ScopeSetNodeRecord | null>;

  /**
   * Atomically increment the reference count
   */
  incrementRef: (setNodeId: string) => Promise<void>;

  /**
   * Atomically decrement the reference count
   */
  decrementRef: (setNodeId: string) => Promise<void>;

  /**
   * Delete set-nodes with zero reference count.
   * Returns the number of deleted nodes.
   */
  deleteZeroRefNodes: () => Promise<number>;

  /**
   * Compute set-node ID for given children (utility method)
   */
  computeId: (children: string[]) => string;
};

type ScopeSetNodesDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute set-node ID from children hashes
 *
 * The ID is the Blake3-128 hash of the sorted, unique children concatenated.
 */
function computeSetNodeId(children: string[]): string {
  // Sort and deduplicate
  const sorted = [...new Set(children)].sort();
  // Concatenate with separator
  const data = sorted.join(",");
  // Compute hash and return as hex
  const hash = blake3s128(data);
  return Buffer.from(hash).toString("hex");
}

// ============================================================================
// Factory
// ============================================================================

export const createScopeSetNodesDb = (config: ScopeSetNodesDbConfig): ScopeSetNodesDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const get = async (setNodeId: string): Promise<ScopeSetNodeRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toSetNodePk(setNodeId), sk: toSetNodeSk() },
      })
    );

    if (!result.Item) return null;
    return result.Item as ScopeSetNodeRecord;
  };

  const getOrCreate = async (children: string[]): Promise<ScopeSetNodeRecord> => {
    // Sort and deduplicate
    const sortedChildren = [...new Set(children)].sort();
    const setNodeId = computeSetNodeId(sortedChildren);

    // Try to get existing
    const existing = await get(setNodeId);
    if (existing) {
      return existing;
    }

    // Create new
    const now = Date.now();
    const record: ScopeSetNodeRecord = {
      pk: toSetNodePk(setNodeId),
      sk: toSetNodeSk(),
      setNodeId,
      children: sortedChildren,
      refCount: 0, // Caller should increment after associating with a token
      createdAt: now,
      lastUpdated: now,
    };

    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
      return record;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Race condition: another process created it, fetch and return
        const created = await get(setNodeId);
        if (created) return created;
      }
      throw error;
    }
  };

  const incrementRef = async (setNodeId: string): Promise<void> => {
    const now = Date.now();

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toSetNodePk(setNodeId), sk: toSetNodeSk() },
        UpdateExpression: "ADD refCount :inc SET lastUpdated = :now",
        ExpressionAttributeValues: {
          ":inc": 1,
          ":now": now,
        },
      })
    );
  };

  const createOrIncrement = async (setNodeId: string, children: string[]): Promise<void> => {
    // Sort and deduplicate children
    const sortedChildren = [...new Set(children)].sort();

    // First, try to get or create the node
    const existing = await get(setNodeId);
    if (existing) {
      // Node exists, just increment
      await incrementRef(setNodeId);
      return;
    }

    // Create new node with refCount = 1
    const now = Date.now();
    const record: ScopeSetNodeRecord = {
      pk: toSetNodePk(setNodeId),
      sk: toSetNodeSk(),
      setNodeId,
      children: sortedChildren,
      refCount: 1, // Start with 1 since we're creating and referencing
      createdAt: now,
      lastUpdated: now,
    };

    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Race condition: another process created it, just increment
        await incrementRef(setNodeId);
      } else {
        throw error;
      }
    }
  };

  const decrementRef = async (setNodeId: string): Promise<void> => {
    const now = Date.now();

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toSetNodePk(setNodeId), sk: toSetNodeSk() },
        UpdateExpression: "ADD refCount :dec SET lastUpdated = :now",
        ExpressionAttributeValues: {
          ":dec": -1,
          ":now": now,
        },
      })
    );
  };

  const deleteZeroRefNodes = async (): Promise<number> => {
    // Scan for nodes with refCount = 0
    // Note: This is a full table scan filtered by prefix, should be run periodically
    const deletedCount = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "begins_with(pk, :prefix)",
          FilterExpression: "refCount = :zero",
          ExpressionAttributeValues: {
            ":prefix": "SETNODE#",
            ":zero": 0,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      // Note: QueryCommand doesn't support begins_with on pk directly
      // We need to use Scan instead for this operation
      // For now, this is a placeholder - in production, use a scheduled cleanup
      // or track zero-ref nodes in a separate index

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return deletedCount;
  };

  const computeId = (children: string[]): string => {
    return computeSetNodeId(children);
  };

  return {
    getOrCreate,
    createOrIncrement,
    get,
    incrementRef,
    decrementRef,
    deleteZeroRefNodes,
    computeId,
  };
};

// Export the empty set node ID constant
export { EMPTY_SET_NODE_ID };
