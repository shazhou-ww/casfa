/**
 * AWP Pending Authorization database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { AwpPendingAuth } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type AwpPendingDb = {
  create: (data: AwpPendingAuth) => Promise<void>;
  get: (pubkey: string) => Promise<AwpPendingAuth | null>;
  delete: (pubkey: string) => Promise<void>;
  validateCode: (pubkey: string, code: string) => Promise<boolean>;
};

type AwpPendingDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createAwpPendingDb = (config: AwpPendingDbConfig): AwpPendingDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const create = async (data: AwpPendingAuth): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `AWP_PENDING#${data.pubkey}`,
          sk: "AUTH",
          ...data,
        },
      })
    );
  };

  const get = async (pubkey: string): Promise<AwpPendingAuth | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `AWP_PENDING#${pubkey}`, sk: "AUTH" },
      })
    );

    if (!result.Item) return null;

    // Check if expired
    if (result.Item.expiresAt < Date.now()) {
      await deleteEntry(pubkey);
      return null;
    }

    return {
      pubkey: result.Item.pubkey,
      clientName: result.Item.clientName,
      verificationCode: result.Item.verificationCode,
      createdAt: result.Item.createdAt,
      expiresAt: result.Item.expiresAt,
    };
  };

  const deleteEntry = async (pubkey: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: `AWP_PENDING#${pubkey}`, sk: "AUTH" },
      })
    );
  };

  const validateCode = async (pubkey: string, code: string): Promise<boolean> => {
    const pending = await get(pubkey);
    if (!pending) return false;
    return pending.verificationCode === code;
  };

  return {
    create,
    get,
    delete: deleteEntry,
    validateCode,
  };
};
