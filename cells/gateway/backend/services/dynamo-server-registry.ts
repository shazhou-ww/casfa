import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RegisteredServer, ServerRegistry } from "./server-registry.ts";

function userPk(userId: string): string {
  return `USER#${userId}`;
}

function serverSk(serverId: string): string {
  return `SERVER#${serverId}`;
}

type ServerItem = {
  pk: string;
  sk: string;
  id: string;
  name: string;
  url: string;
};

function itemToServer(item: ServerItem | undefined): RegisteredServer | null {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    url: item.url,
  };
}

export function createDynamoServerRegistry(params: {
  tableName: string;
  clientConfig?: ConstructorParameters<typeof DynamoDBClient>[0];
}): ServerRegistry {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(params.clientConfig ?? {}));
  const tableName = params.tableName;

  return {
    async list(userId) {
      const res = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":pk": userPk(userId),
            ":prefix": "SERVER#",
          },
        })
      );
      return (res.Items ?? [])
        .map((item) => itemToServer(item as ServerItem))
        .filter((item): item is RegisteredServer => item !== null)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async search(userId, query) {
      const q = query.trim().toLowerCase();
      if (!q) return this.list(userId);
      const rows = await this.list(userId);
      return rows.filter(
        (server) =>
          server.id.toLowerCase().includes(q) ||
          server.name.toLowerCase().includes(q) ||
          server.url.toLowerCase().includes(q)
      );
    },
    async add(userId, server) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: userPk(userId),
            sk: serverSk(server.id),
            id: server.id,
            name: server.name,
            url: server.url,
          } satisfies ServerItem,
        })
      );
    },
    async remove(userId, serverId) {
      const key = { pk: userPk(userId), sk: serverSk(serverId) };
      const existing = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: key,
        })
      );
      if (!existing.Item) return false;
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: key,
        })
      );
      return true;
    },
    async get(userId, serverId) {
      const res = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: userPk(userId), sk: serverSk(serverId) },
        })
      );
      return itemToServer(res.Item as ServerItem | undefined);
    },
  };
}
