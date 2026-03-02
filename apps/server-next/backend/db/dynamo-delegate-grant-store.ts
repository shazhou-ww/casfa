/**
 * DynamoDB-backed DelegateGrantStore.
 * Table: PK=GRANT#delegateId, SK=METADATA; GSI1: realm-hash-index (gsi1pk=REALM#realmId, gsi1sk=HASH#accessTokenHash); GSI2: realm-refresh-index (gsi2pk=REALM#realmId, gsi2sk=REFRESH#refreshTokenHash).
 */
import type { DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DelegateGrant, DelegateGrantStore } from "./delegate-grants.ts";

const PK_PREFIX = "GRANT#";
const SK_METADATA = "METADATA";
const GSI1_NAME = "realm-hash-index";
const GSI1PK_PREFIX = "REALM#";
const GSI1SK_PREFIX = "HASH#";
const GSI2_NAME = "realm-refresh-index";
const GSI2PK_PREFIX = "REALM#";
const GSI2SK_PREFIX = "REFRESH#";

export type DynamoDelegateGrantStoreConfig = {
  tableName: string;
  clientConfig?: DynamoDBClientConfig;
};

function toPk(delegateId: string): string {
  return `${PK_PREFIX}${delegateId}`;
}

function toGsi1Pk(realmId: string): string {
  return `${GSI1PK_PREFIX}${realmId}`;
}

function toGsi1Sk(accessTokenHash: string): string {
  return `${GSI1SK_PREFIX}${accessTokenHash}`;
}

function toGsi2Pk(realmId: string): string {
  return `${GSI2PK_PREFIX}${realmId}`;
}

function toGsi2Sk(refreshTokenHash: string): string {
  return `${GSI2SK_PREFIX}${refreshTokenHash}`;
}

function grantToItem(grant: DelegateGrant): Record<string, unknown> {
  const item: Record<string, unknown> = {
    pk: toPk(grant.delegateId),
    sk: SK_METADATA,
    gsi1pk: toGsi1Pk(grant.realmId),
    gsi1sk: toGsi1Sk(grant.accessTokenHash),
    delegateId: grant.delegateId,
    realmId: grant.realmId,
    clientId: grant.clientId,
    accessTokenHash: grant.accessTokenHash,
    refreshTokenHash: grant.refreshTokenHash,
    permissions: grant.permissions,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
  };
  if (grant.refreshTokenHash) {
    item.gsi2pk = toGsi2Pk(grant.realmId);
    item.gsi2sk = toGsi2Sk(grant.refreshTokenHash);
  }
  return item;
}

function itemToGrant(item: Record<string, unknown>): DelegateGrant {
  return {
    delegateId: item.delegateId as string,
    realmId: item.realmId as string,
    clientId: item.clientId as string,
    accessTokenHash: item.accessTokenHash as string,
    refreshTokenHash: item.refreshTokenHash as string | null,
    permissions: item.permissions as DelegateGrant["permissions"],
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number | null,
  };
}

export function createDynamoDelegateGrantStore(
  config: DynamoDelegateGrantStoreConfig
): DelegateGrantStore {
  const client = new DynamoDBClient(config.clientConfig ?? {});
  const doc = DynamoDBDocumentClient.from(client);
  const tableName = config.tableName;

  return {
    async list(realmId: string) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": toGsi1Pk(realmId) },
        })
      );
      return (r.Items ?? []).map((i) =>
        itemToGrant(i as Record<string, unknown>)
      );
    },

    async get(delegateId: string) {
      const r = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: toPk(delegateId), sk: SK_METADATA },
        })
      );
      if (!r.Item) return null;
      return itemToGrant(r.Item as Record<string, unknown>);
    },

    async getByAccessTokenHash(realmId: string, hash: string) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": toGsi1Pk(realmId),
            ":sk": toGsi1Sk(hash),
          },
          Limit: 1,
        })
      );
      const item = r.Items?.[0];
      if (!item) return null;
      return itemToGrant(item as Record<string, unknown>);
    },

    async getByRefreshTokenHash(realmId: string, refreshTokenHash: string) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI2_NAME,
          KeyConditionExpression: "gsi2pk = :pk AND gsi2sk = :sk",
          ExpressionAttributeValues: {
            ":pk": toGsi2Pk(realmId),
            ":sk": toGsi2Sk(refreshTokenHash),
          },
          Limit: 1,
        })
      );
      const item = r.Items?.[0];
      if (!item) return null;
      return itemToGrant(item as Record<string, unknown>);
    },

    async insert(grant: DelegateGrant) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: grantToItem(grant) as Record<string, unknown>,
        })
      );
    },

    async remove(delegateId: string) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: toPk(delegateId), sk: SK_METADATA },
        })
      );
    },

    async updateTokens(
      delegateId: string,
      update: { accessTokenHash: string; refreshTokenHash?: string }
    ) {
      const g = await this.get(delegateId);
      if (!g) return;
      const updated: DelegateGrant = {
        ...g,
        accessTokenHash: update.accessTokenHash,
        refreshTokenHash: update.refreshTokenHash ?? g.refreshTokenHash,
      };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: grantToItem(updated) as Record<string, unknown>,
        })
      );
    },
  };
}
