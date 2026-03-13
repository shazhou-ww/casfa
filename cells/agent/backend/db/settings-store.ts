/**
 * DynamoDB-backed settings store. LWW per key.
 * pk = REALM#realmId, sk = SETTING#key
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Setting } from "../types.ts";

const REALM_PK_PREFIX = "REALM#";
const SETTING_SK_PREFIX = "SETTING#";

function realmPk(realmId: string): string {
  return `${REALM_PK_PREFIX}${realmId}`;
}

function settingSk(key: string): string {
  return `${SETTING_SK_PREFIX}${key}`;
}

export type SettingsStoreConfig = {
  tableName: string;
  doc: DynamoDBDocumentClient;
};

export type SettingsStore = {
  list(realmId: string): Promise<Setting[]>;
  get(realmId: string, key: string): Promise<{ value: unknown; updatedAt: number } | null>;
  set(realmId: string, key: string, value: unknown): Promise<Setting>;
};

export function createSettingsStore(config: SettingsStoreConfig): SettingsStore {
  const { tableName, doc } = config;

  return {
    async list(realmId) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": realmPk(realmId),
            ":skPrefix": SETTING_SK_PREFIX,
          },
        })
      );
      return (r.Items ?? []).map((i) => {
        const item = i as Record<string, unknown>;
        return {
          key: item.key as string,
          value: item.value,
          updatedAt: item.updatedAt as number,
        };
      });
    },

    async get(realmId, key) {
      const r = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: realmPk(realmId), sk: settingSk(key) },
        })
      );
      if (!r.Item) return null;
      const item = r.Item as Record<string, unknown>;
      return {
        value: item.value,
        updatedAt: item.updatedAt as number,
      };
    },

    async set(realmId, key, value) {
      const now = Date.now();
      const item = {
        pk: realmPk(realmId),
        sk: settingSk(key),
        key,
        value,
        updatedAt: now,
      };
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return { key, value, updatedAt: now };
    },
  };
}
