/**
 * Store for pending OAuth client info (client_name from dynamic registration).
 * Used by stub registration; items have TTL for auto-delete; also delete on authorize success or user deny.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const DEFAULT_TTL_SEC = 3600; // 1 hour

export type PendingClientInfoStore = {
  put(clientId: string, clientName: string, ttlSec?: number): Promise<void>;
  get(clientId: string): Promise<string | null>;
  delete(clientId: string): Promise<void>;
};

export function createDynamoPendingClientInfoStore(deps: {
  tableName: string;
  client: DynamoDBDocumentClient;
}): PendingClientInfoStore {
  const { tableName, client } = deps;

  return {
    async put(clientId: string, clientName: string, ttlSec = DEFAULT_TTL_SEC) {
      const ttl = Math.floor(Date.now() / 1000) + ttlSec;
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: clientId,
            client_name: clientName,
            ttl,
          },
        })
      );
    },

    async get(clientId: string): Promise<string | null> {
      const out = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: clientId },
        })
      );
      const name = out.Item?.client_name;
      return typeof name === "string" ? name : null;
    },

    async delete(clientId: string) {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: clientId },
        })
      );
    },
  };
}

export function createMemoryPendingClientInfoStore(): PendingClientInfoStore {
  const byId = new Map<string, { name: string }>();
  return {
    async put(clientId: string, clientName: string) {
      byId.set(clientId, { name: clientName });
    },
    async get(clientId: string) {
      return byId.get(clientId)?.name ?? null;
    },
    async delete(clientId: string) {
      byId.delete(clientId);
    },
  };
}
