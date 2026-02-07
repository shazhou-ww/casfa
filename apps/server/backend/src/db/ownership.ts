/**
 * CAS Ownership database operations
 *
 * Multi-owner model: each PUT creates an ownership record keyed by ownerId.
 * Sort Key format: OWN#{hex_key}##{ownerId}
 * ownerId is typically a Delegate Token ID or User ID (NOT Access Token ID).
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { CasOwnership, NodeKind } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type OwnershipDb = {
  /** Check if any owner exists for this node in the realm */
  hasOwnership: (realm: string, key: string) => Promise<boolean>;
  /** Check if a specific ownerId has ownership of this node */
  hasOwnershipByToken: (realm: string, key: string, ownerId: string) => Promise<boolean>;
  /** Get the first ownership record for this node (for backward compat) */
  getOwnership: (realm: string, key: string) => Promise<CasOwnership | null>;
  /** List all ownerIds for a given node in a realm */
  listOwners: (realm: string, key: string) => Promise<string[]>;
  /** Add ownership for a node (ownerId is DT ID or User ID) */
  addOwnership: (
    realm: string,
    key: string,
    ownerId: string,
    contentType: string,
    size: number,
    kind?: NodeKind
  ) => Promise<void>;
  /** List all ownership records in a realm */
  listByRealm: (
    realm: string,
    options?: { limit?: number; startKey?: string }
  ) => Promise<{
    items: CasOwnership[];
    nextKey?: string;
  }>;
  /** Delete a specific ownership record */
  deleteOwnership: (realm: string, key: string, ownerId: string) => Promise<void>;
};

type OwnershipDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Helpers
// ============================================================================

/** Build the SK for a specific owner record */
const toOwnerSk = (key: string, ownerId: string): string => `OWN#${key}##${ownerId}`;

/** Build the SK prefix for all owners of a node */
const toOwnerPrefix = (key: string): string => `OWN#${key}##`;

/** Parse a CasOwnership from a DDB item with multi-owner SK format */
const parseOwnershipItem = (item: Record<string, unknown>): CasOwnership => {
  const sk = item.key as string;
  // SK format: OWN#{hex_key}##{ownerId}
  const withoutPrefix = sk.slice(4); // Remove "OWN#"
  const separatorIdx = withoutPrefix.indexOf("##");
  const nodeKey = separatorIdx >= 0 ? withoutPrefix.slice(0, separatorIdx) : withoutPrefix;
  const ownerId =
    separatorIdx >= 0 ? withoutPrefix.slice(separatorIdx + 2) : ((item.ownerId as string) ?? "");

  return {
    realm: item.realm as string,
    key: nodeKey,
    kind: item.kind as NodeKind | undefined,
    createdAt: item.createdAt as number,
    ownerId: ownerId,
    contentType: item.contentType as string | undefined,
    size: item.size as number,
  };
};

// ============================================================================
// Factory
// ============================================================================

export const createOwnershipDb = (config: OwnershipDbConfig): OwnershipDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const hasOwnership = async (realm: string, key: string): Promise<boolean> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: { "#key": "key" },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": toOwnerPrefix(key),
        },
        Limit: 1,
        ProjectionExpression: "realm",
      })
    );
    return (result.Items?.length ?? 0) > 0;
  };

  const hasOwnershipByToken = async (
    realm: string,
    key: string,
    ownerId: string
  ): Promise<boolean> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: toOwnerSk(key, ownerId) },
        ProjectionExpression: "realm",
      })
    );
    return !!result.Item;
  };

  const getOwnership = async (realm: string, key: string): Promise<CasOwnership | null> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: { "#key": "key" },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": toOwnerPrefix(key),
        },
        Limit: 1,
      })
    );
    if (!result.Items || result.Items.length === 0) return null;
    return parseOwnershipItem(result.Items[0] as Record<string, unknown>);
  };

  const listOwners = async (realm: string, key: string): Promise<string[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: { "#key": "key" },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": toOwnerPrefix(key),
        },
        ProjectionExpression: "#key",
      })
    );

    return (result.Items ?? [])
      .map((item) => {
        const sk = item.key as string;
        const withoutPrefix = sk.slice(4); // Remove "OWN#"
        const separatorIdx = withoutPrefix.indexOf("##");
        return separatorIdx >= 0 ? withoutPrefix.slice(separatorIdx + 2) : "";
      })
      .filter(Boolean);
  };

  const addOwnership = async (
    realm: string,
    key: string,
    ownerId: string,
    contentType: string,
    size: number,
    kind?: NodeKind
  ): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          realm,
          key: toOwnerSk(key, ownerId),
          kind,
          createdAt: Date.now(),
          ownerId,
          contentType,
          size,
        },
      })
    );
  };

  const listByRealm = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ items: CasOwnership[]; nextKey?: string }> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: { "#key": "key" },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": "OWN#",
        },
        Limit: options.limit ?? 100,
        ExclusiveStartKey: options.startKey ? { realm, key: options.startKey } : undefined,
      })
    );

    const items = (result.Items ?? []).map((item) =>
      parseOwnershipItem(item as Record<string, unknown>)
    );

    const nextKey = result.LastEvaluatedKey ? (result.LastEvaluatedKey.key as string) : undefined;

    return { items, nextKey };
  };

  const deleteOwnership = async (realm: string, key: string, ownerId: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { realm, key: toOwnerSk(key, ownerId) },
      })
    );
  };

  return {
    hasOwnership,
    hasOwnershipByToken,
    getOwnership,
    listOwners,
    addOwnership,
    listByRealm,
    deleteOwnership,
  };
};
