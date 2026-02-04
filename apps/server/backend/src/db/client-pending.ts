/**
 * Client Pending Authorization database operations
 *
 * Stores pending client authorizations indexed by clientId
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ClientPendingAuth } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type ClientPendingDb = {
  create: (data: ClientPendingAuth) => Promise<void>;
  getByClientId: (clientId: string) => Promise<ClientPendingAuth | null>;
  delete: (clientId: string) => Promise<void>;
};

type ClientPendingDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createClientPendingDb = (config: ClientPendingDbConfig): ClientPendingDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const create = async (data: ClientPendingAuth): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `CLIENT_PENDING#${data.clientId}`,
          sk: "AUTH",
          ...data,
        },
      })
    );
  };

  const getByClientId = async (clientId: string): Promise<ClientPendingAuth | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `CLIENT_PENDING#${clientId}`, sk: "AUTH" },
      })
    );

    if (!result.Item) return null;

    // Check if expired
    if (result.Item.expiresAt < Date.now()) {
      await deleteEntry(clientId);
      return null;
    }

    return {
      clientId: result.Item.clientId,
      pubkey: result.Item.pubkey,
      clientName: result.Item.clientName,
      displayCode: result.Item.displayCode,
      createdAt: result.Item.createdAt,
      expiresAt: result.Item.expiresAt,
    };
  };

  const deleteEntry = async (clientId: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: `CLIENT_PENDING#${clientId}`, sk: "AUTH" },
      })
    );
  };

  return {
    create,
    getByClientId,
    delete: deleteEntry,
  };
};
