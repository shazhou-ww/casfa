/**
 * User roles database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { UserRole } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type UserRoleRecord = {
  userId: string;
  role: UserRole;
};

export type UserRolesDb = {
  getRole: (userId: string) => Promise<UserRole>;
  setRole: (userId: string, role: UserRole) => Promise<void>;
  revoke: (userId: string) => Promise<void>;
  listRoles: () => Promise<UserRoleRecord[]>;
};

type UserRolesDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createUserRolesDb = (config: UserRolesDbConfig): UserRolesDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const getRole = async (userId: string): Promise<UserRole> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `USER#${userId}`, sk: "ROLE" },
      })
    );

    if (!result.Item) {
      return "unauthorized";
    }

    return result.Item.role as UserRole;
  };

  const setRole = async (userId: string, role: UserRole): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `USER#${userId}`,
          sk: "ROLE",
          userId,
          role,
          updatedAt: Date.now(),
        },
      })
    );
  };

  const revoke = async (userId: string): Promise<void> => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: `USER#${userId}`, sk: "ROLE" },
      })
    );
  };

  const listRoles = async (): Promise<UserRoleRecord[]> => {
    const result = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "sk = :sk",
        ExpressionAttributeValues: { ":sk": "ROLE" },
      })
    );

    return (result.Items ?? []).map((item) => ({
      userId: item.userId,
      role: item.role as UserRole,
    }));
  };

  return {
    getRole,
    setRole,
    revoke,
    listRoles,
  };
};
