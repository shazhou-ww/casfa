/**
 * Client Public Keys database operations
 *
 * Stores registered client public keys indexed by clientId
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { ClientPubkey } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type ClientPubkeysDb = {
  store: (data: ClientPubkey) => Promise<void>;
  getByClientId: (clientId: string) => Promise<ClientPubkey | null>;
  lookupByPubkey: (pubkey: string) => Promise<ClientPubkey | null>;
  listByUser: (userId: string) => Promise<ClientPubkey[]>;
  revokeByClientId: (clientId: string) => Promise<void>;
};

type ClientPubkeysDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createClientPubkeysDb = (config: ClientPubkeysDbConfig): ClientPubkeysDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const store = async (data: ClientPubkey): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `CLIENT#${data.clientId}`,
          sk: "KEY",
          gsi1pk: `USER#${data.userId}`,
          gsi1sk: `CLIENT#${data.clientId}`,
          gsi2pk: `PUBKEY#${data.pubkey}`,
          gsi2sk: "KEY",
          ...data,
        },
      })
    );
  };

  const getByClientId = async (clientId: string): Promise<ClientPubkey | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `CLIENT#${clientId}`, sk: "KEY" },
      })
    );

    if (!result.Item) return null;

    // Check if expired
    if (result.Item.expiresAt && result.Item.expiresAt < Date.now()) {
      await revokeByClientId(clientId);
      return null;
    }

    return mapToClientPubkey(result.Item);
  };

  const lookupByPubkey = async (pubkey: string): Promise<ClientPubkey | null> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi2",
        KeyConditionExpression: "gsi2pk = :pk AND gsi2sk = :sk",
        ExpressionAttributeValues: {
          ":pk": `PUBKEY#${pubkey}`,
          ":sk": "KEY",
        },
      })
    );

    if (!result.Items || result.Items.length === 0) return null;

    const item = result.Items[0];
    if (!item) return null;

    // Check if expired
    if (item.expiresAt && item.expiresAt < Date.now()) {
      await revokeByClientId(item.clientId as string);
      return null;
    }

    return mapToClientPubkey(item);
  };

  const listByUser = async (userId: string): Promise<ClientPubkey[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":prefix": "CLIENT#",
        },
      })
    );

    const now = Date.now();
    return (result.Items ?? [])
      .filter((item) => !item.expiresAt || item.expiresAt > now)
      .map(mapToClientPubkey);
  };

  const revokeByClientId = async (clientId: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: `CLIENT#${clientId}`, sk: "KEY" },
      })
    );
  };

  return {
    store,
    getByClientId,
    lookupByPubkey,
    listByUser,
    revokeByClientId,
  };
};

// ============================================================================
// Helpers
// ============================================================================

function mapToClientPubkey(item: Record<string, unknown>): ClientPubkey {
  return {
    clientId: item.clientId as string,
    pubkey: item.pubkey as string,
    userId: item.userId as string,
    clientName: item.clientName as string,
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number | undefined,
  };
}
