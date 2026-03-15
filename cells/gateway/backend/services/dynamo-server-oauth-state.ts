import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ServerOAuthState, ServerOAuthStateStore } from "./server-oauth-state.ts";

function userPk(userId: string): string {
  return `USER#${userId}`;
}

function serverSk(serverId: string): string {
  return `SERVER#${serverId}`;
}

type OAuthStateItem = {
  pk: string;
  sk: string;
  serverId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

function itemToState(item: OAuthStateItem | undefined): ServerOAuthState | null {
  if (!item) return null;
  return {
    serverId: item.serverId,
    accessToken: item.accessToken,
    refreshToken: item.refreshToken,
    expiresAt: item.expiresAt,
  };
}

export function createDynamoServerOAuthStateStore(params: {
  tableName: string;
  clientConfig?: ConstructorParameters<typeof DynamoDBClient>[0];
}): ServerOAuthStateStore {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(params.clientConfig ?? {}));
  const tableName = params.tableName;

  return {
    async get(userId, serverId) {
      const res = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: userPk(userId), sk: serverSk(serverId) },
        })
      );
      return itemToState(res.Item as OAuthStateItem | undefined);
    },
    async set(userId, state) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: userPk(userId),
            sk: serverSk(state.serverId),
            serverId: state.serverId,
            accessToken: state.accessToken,
            refreshToken: state.refreshToken,
            expiresAt: state.expiresAt,
          } satisfies OAuthStateItem,
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
        .map((item) => itemToState(item as OAuthStateItem))
        .filter((item): item is ServerOAuthState => item !== null)
        .sort((a, b) => a.serverId.localeCompare(b.serverId));
    },
  };
}
