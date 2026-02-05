/**
 * AWP Public Keys database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { AwpPubkey } from "../../types.ts";
import { createDocClient } from "../client.ts";

// ============================================================================
// Types
// ============================================================================

export type AwpPubkeysDb = {
  store: (data: AwpPubkey) => Promise<void>;
  lookup: (pubkey: string) => Promise<AwpPubkey | null>;
  listByUser: (userId: string) => Promise<AwpPubkey[]>;
  revoke: (pubkey: string) => Promise<void>;
};

type AwpPubkeysDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createAwpPubkeysDb = (config: AwpPubkeysDbConfig): AwpPubkeysDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const store = async (data: AwpPubkey): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `AWP_PUBKEY#${data.pubkey}`,
          sk: "KEY",
          gsi1pk: `USER#${data.userId}`,
          gsi1sk: `AWP#${data.pubkey}`,
          ...data,
        },
      })
    );
  };

  const lookup = async (pubkey: string): Promise<AwpPubkey | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `AWP_PUBKEY#${pubkey}`, sk: "KEY" },
      })
    );

    if (!result.Item) return null;

    // Check if expired
    if (result.Item.expiresAt && result.Item.expiresAt < Date.now()) {
      await revoke(pubkey);
      return null;
    }

    return {
      pubkey: result.Item.pubkey,
      userId: result.Item.userId,
      clientName: result.Item.clientName,
      createdAt: result.Item.createdAt,
      expiresAt: result.Item.expiresAt,
    };
  };

  const listByUser = async (userId: string): Promise<AwpPubkey[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":prefix": "AWP#",
        },
      })
    );

    const now = Date.now();
    return (result.Items ?? [])
      .filter((item) => !item.expiresAt || item.expiresAt > now)
      .map((item) => ({
        pubkey: item.pubkey,
        userId: item.userId,
        clientName: item.clientName,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
      }));
  };

  const revoke = async (pubkey: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: `AWP_PUBKEY#${pubkey}`, sk: "KEY" },
      })
    );
  };

  return {
    store,
    lookup,
    listByUser,
    revoke,
  };
};
