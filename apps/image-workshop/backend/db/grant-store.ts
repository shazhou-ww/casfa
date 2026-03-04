import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DelegateGrant, DelegateGrantStore } from "../types/auth";

type GrantStoreConfig = {
  tableName: string;
  clientConfig?: ConstructorParameters<typeof DynamoDBClient>[0];
};

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
    expiresAt: (item.expiresAt as number) ?? null,
  };
}

export function createGrantStore(config: GrantStoreConfig): DelegateGrantStore {
  const client = new DynamoDBClient(config.clientConfig ?? {});
  const doc = DynamoDBDocumentClient.from(client);
  const tableName = config.tableName;

  return {
    async list(userId) {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        })
      );
      return (result.Items ?? []).map(fromItem);
    },

    async get(delegateId) {
      const result = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        })
      );
      return result.Item ? fromItem(result.Item) : null;
    },

    async getByAccessTokenHash(userId, hash) {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-hash-index",
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `HASH#${hash}`,
          },
        })
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async getByRefreshTokenHash(userId, hash) {
      const result = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "user-refresh-index",
          KeyConditionExpression: "gsi2pk = :pk AND gsi2sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":sk": `REFRESH#${hash}`,
          },
        })
      );
      const items = result.Items ?? [];
      return items.length > 0 ? fromItem(items[0]) : null;
    },

    async insert(grant) {
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(grant) }));
    },

    async remove(delegateId) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        })
      );
    },

    async updateTokens(delegateId, update) {
      const existing = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: `GRANT#${delegateId}`, sk: "METADATA" },
        })
      );
      if (!existing.Item) throw new Error("Grant not found");
      const grant = fromItem(existing.Item);
      grant.accessTokenHash = update.accessTokenHash;
      if (update.refreshTokenHash !== undefined) {
        grant.refreshTokenHash = update.refreshTokenHash;
      }
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(grant) }));
    },
  };
}
