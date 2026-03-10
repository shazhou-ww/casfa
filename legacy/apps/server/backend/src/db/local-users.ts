/**
 * Local user store for dev/local authentication
 *
 * Stores users in the cas-realm DynamoDB table using USER_LOCAL# partition keys.
 * Only active when MOCK_JWT_SECRET is set (local dev mode).
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type LocalUserRecord = {
  email: string;
  passwordHash: string;
  userId: string;
  name: string;
  createdAt: number;
};

export type LocalUsersDb = {
  createUser: (email: string, passwordHash: string, userId: string, name: string) => Promise<void>;
  findByEmail: (email: string) => Promise<LocalUserRecord | null>;
};

type LocalUsersDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createLocalUsersDb = (config: LocalUsersDbConfig): LocalUsersDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const createUser = async (
    email: string,
    passwordHash: string,
    userId: string,
    name: string
  ): Promise<void> => {
    const now = Date.now();
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `USER_LOCAL#${email}`,
          sk: "PROFILE",
          email,
          passwordHash,
          userId,
          name,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  };

  const findByEmail = async (email: string): Promise<LocalUserRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `USER_LOCAL#${email}`, sk: "PROFILE" },
      })
    );

    if (!result.Item) return null;

    return {
      email: result.Item.email,
      passwordHash: result.Item.passwordHash,
      userId: result.Item.userId,
      name: result.Item.name,
      createdAt: result.Item.createdAt,
    };
  };

  return { createUser, findByEmail };
};
