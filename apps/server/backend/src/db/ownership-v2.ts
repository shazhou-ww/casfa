/**
 * CAS Ownership v2 — Delegate-chain-based ownership
 *
 * New ownership model: full-chain writes on upload, O(1) GetItem on query.
 *
 * Key schema (on tokensTable — pk/sk composite key):
 *   PK = OWN#{nodeHash}
 *   SK = {delegateId}
 *
 * Each upload writes N records (N = chain.length), one per delegate in the chain.
 * All records share the same uploadedBy, kind, size, contentType metadata.
 *
 * Querying: GetItem(PK, SK) — O(1) for any delegate in the uploader's chain.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

/** Metadata stored with each ownership record */
export type OwnershipRecord = {
  /** The actual delegate that performed the upload */
  uploadedBy: string;
  /** Node type: "file" | "dict" */
  kind?: string;
  /** Logical size in bytes */
  size: number;
  /** MIME content type */
  contentType?: string;
  /** When the ownership record was created (epoch ms) */
  createdAt: number;
};

export type OwnershipV2Db = {
  /**
   * Add ownership records for a node — full-chain write.
   * Writes one record per delegate in the chain using BatchWriteItem.
   * Idempotent: re-uploading the same node overwrites silently.
   *
   * @param nodeHash - The CAS node hash (hex string)
   * @param chain - Uploader's full delegate chain [root, ..., self]
   * @param uploadedBy - The delegate that actually performed the upload (last in chain)
   * @param contentType - MIME content type
   * @param size - Logical size in bytes
   * @param kind - Node type ("file" | "dict")
   */
  addOwnership: (
    nodeHash: string,
    chain: string[],
    uploadedBy: string,
    contentType: string,
    size: number,
    kind?: string,
  ) => Promise<void>;

  /**
   * Check if a specific delegate owns a node — O(1) GetItem.
   * Returns true if the delegate (or any descendant) has uploaded this node.
   *
   * @param nodeHash - The CAS node hash (hex string)
   * @param delegateId - The delegate to check
   */
  hasOwnership: (nodeHash: string, delegateId: string) => Promise<boolean>;

  /**
   * Check if any delegate owns a node — Query + Limit 1.
   * Used for "does this node exist in the realm" checks.
   *
   * @param nodeHash - The CAS node hash (hex string)
   */
  hasAnyOwnership: (nodeHash: string) => Promise<boolean>;

  /**
   * Get the ownership record for a specific delegate + node.
   *
   * @param nodeHash - The CAS node hash (hex string)
   * @param delegateId - The delegate to look up
   */
  getOwnership: (
    nodeHash: string,
    delegateId: string,
  ) => Promise<OwnershipRecord | null>;

  /**
   * List all delegates that own a specific node.
   *
   * @param nodeHash - The CAS node hash (hex string)
   */
  listOwners: (nodeHash: string) => Promise<string[]>;
};

type OwnershipV2DbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Key Helpers
// ============================================================================

/** Ownership partition key: OWN#{nodeHash} */
const toOwnershipPk = (nodeHash: string): string => `OWN#${nodeHash}`;

// ============================================================================
// Factory
// ============================================================================

export const createOwnershipV2Db = (
  config: OwnershipV2DbConfig,
): OwnershipV2Db => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const addOwnership = async (
    nodeHash: string,
    chain: string[],
    uploadedBy: string,
    contentType: string,
    size: number,
    kind?: string,
  ): Promise<void> => {
    if (chain.length === 0) return;

    const pk = toOwnershipPk(nodeHash);
    const now = Date.now();

    // Build PutRequest items for each delegate in the chain
    const putRequests = chain.map((delegateId) => ({
      PutRequest: {
        Item: {
          pk,
          sk: delegateId,
          uploadedBy,
          kind,
          size,
          contentType,
          createdAt: now,
        },
      },
    }));

    // BatchWriteItem supports up to 25 items per batch.
    // Chain max depth is 16, so a single batch is always sufficient.
    // But be safe and chunk if needed.
    const BATCH_SIZE = 25;
    for (let i = 0; i < putRequests.length; i += BATCH_SIZE) {
      const batch = putRequests.slice(i, i + BATCH_SIZE);
      await client.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: batch,
          },
        }),
      );
    }
  };

  const hasOwnership = async (
    nodeHash: string,
    delegateId: string,
  ): Promise<boolean> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: toOwnershipPk(nodeHash),
          sk: delegateId,
        },
        ProjectionExpression: "pk",
      }),
    );
    return !!result.Item;
  };

  const hasAnyOwnership = async (nodeHash: string): Promise<boolean> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": toOwnershipPk(nodeHash),
        },
        Limit: 1,
        ProjectionExpression: "pk",
      }),
    );
    return (result.Items?.length ?? 0) > 0;
  };

  const getOwnership = async (
    nodeHash: string,
    delegateId: string,
  ): Promise<OwnershipRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: toOwnershipPk(nodeHash),
          sk: delegateId,
        },
      }),
    );
    if (!result.Item) return null;
    const item = result.Item;
    return {
      uploadedBy: item.uploadedBy as string,
      kind: item.kind as string | undefined,
      size: item.size as number,
      contentType: item.contentType as string | undefined,
      createdAt: item.createdAt as number,
    };
  };

  const listOwners = async (nodeHash: string): Promise<string[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": toOwnershipPk(nodeHash),
        },
        ProjectionExpression: "sk",
      }),
    );
    return (result.Items ?? []).map((item) => item.sk as string);
  };

  return {
    addOwnership,
    hasOwnership,
    hasAnyOwnership,
    getOwnership,
    listOwners,
  };
};
