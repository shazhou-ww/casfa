/**
 * CAS Ownership database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { CasOwnership, NodeKind } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type OwnershipDb = {
  hasOwnership: (realm: string, key: string) => Promise<boolean>;
  getOwnership: (realm: string, key: string) => Promise<CasOwnership | null>;
  addOwnership: (
    realm: string,
    key: string,
    createdBy: string,
    contentType: string,
    size: number,
    kind?: NodeKind
  ) => Promise<void>;
  listByRealm: (
    realm: string,
    options?: { limit?: number; startKey?: string }
  ) => Promise<{
    items: CasOwnership[];
    nextKey?: string;
  }>;
  deleteOwnership: (realm: string, key: string) => Promise<void>;
};

type OwnershipDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createOwnershipDb = (config: OwnershipDbConfig): OwnershipDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const hasOwnership = async (realm: string, key: string): Promise<boolean> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: `OWN#${key}` },
        ProjectionExpression: "realm",
      })
    );
    return !!result.Item;
  };

  const getOwnership = async (realm: string, key: string): Promise<CasOwnership | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: `OWN#${key}` },
      })
    );
    if (!result.Item) return null;

    return {
      realm: result.Item.realm,
      key: (result.Item.key as string).slice(4), // Remove "OWN#"
      kind: result.Item.kind,
      createdAt: result.Item.createdAt,
      createdBy: result.Item.createdBy,
      contentType: result.Item.contentType,
      size: result.Item.size,
    };
  };

  const addOwnership = async (
    realm: string,
    key: string,
    createdBy: string,
    contentType: string,
    size: number,
    kind?: NodeKind
  ): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          realm,
          key: `OWN#${key}`,
          kind,
          createdAt: Date.now(),
          createdBy,
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
        ExclusiveStartKey: options.startKey ? { realm, key: `OWN#${options.startKey}` } : undefined,
      })
    );

    const items = (result.Items ?? []).map((item) => ({
      realm: item.realm as string,
      key: (item.key as string).slice(4),
      kind: item.kind,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      contentType: item.contentType,
      size: item.size,
    }));

    const nextKey = result.LastEvaluatedKey?.key?.slice(4);

    return { items, nextKey };
  };

  const deleteOwnership = async (realm: string, key: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { realm, key: `OWN#${key}` },
      })
    );
  };

  return {
    hasOwnership,
    getOwnership,
    addOwnership,
    listByRealm,
    deleteOwnership,
  };
};
