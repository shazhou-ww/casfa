import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DelegateGrant, DelegateGrantStore } from "./types.ts";

function toItem(g: DelegateGrant) {
  return {
    pk: `GRANT#${g.delegateId}`,
    sk: "METADATA",
    gsi1pk: `USER#${g.userId}`,
    gsi1sk: `HASH#${g.accessTokenHash}`,
    ...(g.refreshTokenHash
      ? { gsi2pk: `USER#${g.userId}`, gsi2sk: `REFRESH#${g.refreshTokenHash}` }
      : {}),
    delegateId: g.delegateId,
    userId: g.userId,
    clientName: g.clientName,
    permissions: g.permissions,
    accessTokenHash: g.accessTokenHash,
    refreshTokenHash: g.refreshTokenHash,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
  };
}

function fromItem(item: Record<string, unknown>): DelegateGrant {
  return {
    delegateId: item.delegateId as string,
    userId: item.userId as string,
    clientName: item.clientName as string,
    permissions: item.permissions as DelegateGrant["permissions"],
    accessTokenHash: item.accessTokenHash as string,
    refreshTokenHash: (item.refreshTokenHash as string) ?? null,
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number,
  };
}

export function createDynamoGrantStore(params: {
  tableName: string;
  client: DynamoDBDocumentClient;
}): DelegateGrantStore {
  const { tableName, client } = params;

  return {
    async list(userId) {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        }),
      );
      return (result.Items ?? []).map(fromItem);
    },

    async get(delegateId) {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        }),
      );
      return result.Item ? fromItem(result.Item) : null;
    },

    async getByAccessTokenHash(userId, hash) {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `HASH#${hash}`,
          },
        }),
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async getByRefreshTokenHash(userId, hash) {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-refresh-index",
          KeyConditionExpression: "gsi2pk = :pk AND gsi2sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `REFRESH#${hash}`,
          },
        }),
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async insert(grant) {
      await client.send(new PutCommand({ TableName: tableName, Item: toItem(grant) }));
    },

    async remove(delegateId) {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        }),
      );
    },

    async updateTokens(delegateId, update) {
      const existing = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        }),
      );
      if (!existing.Item) throw new Error("Grant not found");
      const grant = fromItem(existing.Item);
      grant.accessTokenHash = update.accessTokenHash;
      grant.refreshTokenHash = update.refreshTokenHash;
      await client.send(new PutCommand({ TableName: tableName, Item: toItem(grant) }));
    },
  };
}
