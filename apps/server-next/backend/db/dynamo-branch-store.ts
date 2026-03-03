/**
 * DynamoDB-backed BranchStore for realm root + branch state.
 * Realm root branch is stored on the realm entity: pk=REALM#realmId, sk=REALM, rootBranchId.
 * Branch rows: PK=DLG#branchId, SK=METADATA|ROOT; GSI1: gsi1pk=REALM#realmId, gsi1sk=PARENT#parentId.
 */
import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Branch } from "../types/branch.ts";
import type { BranchStore } from "./branch-store.ts";

const PK_PREFIX = "DLG#";
const REALM_PK_PREFIX = "REALM#";
const SK_METADATA = "METADATA";
const SK_ROOT = "ROOT";
const SK_REALM = "REALM";
const GSI1_NAME = "realm-index";
const GSI1PK_PREFIX = "REALM#";
const GSI1SK_ROOT = "PARENT#ROOT";
const GSI1SK_PREFIX = "PARENT#";

export type DynamoBranchStoreConfig = {
  tableName: string;
  clientConfig?: DynamoDBClientConfig;
};

function toPk(branchId: string): string {
  return `${PK_PREFIX}${branchId}`;
}

function toGsi1Pk(realmId: string): string {
  return `${GSI1PK_PREFIX}${realmId}`;
}

function toGsi1Sk(parentId: string | null): string {
  return parentId === null ? GSI1SK_ROOT : `${GSI1SK_PREFIX}${parentId}`;
}

function realmPk(realmId: string): string {
  return `${REALM_PK_PREFIX}${realmId}`;
}

/** Map Dynamo item (legacy shape) to Branch. */
function itemToBranch(item: Record<string, unknown>): Branch {
  const lifetime = item.lifetime as "limited" | "unlimited" | undefined;
  const expiresAt =
    lifetime === "limited"
      ? (item.expiresAt as number) ?? 0
      : (item.accessExpiresAt as number) ?? 0;
  return {
    branchId: (item.delegateId ?? item.branchId) as string,
    realmId: item.realmId as string,
    parentId: item.parentId as string | null,
    mountPath: (item.mountPath as string) ?? "",
    expiresAt,
  };
}

/** Write Branch as Dynamo item (legacy shape for backward compat). */
function branchToItem(branch: Branch): Record<string, unknown> {
  return {
    delegateId: branch.branchId,
    realmId: branch.realmId,
    parentId: branch.parentId,
    mountPath: branch.mountPath,
    lifetime: "limited",
    accessTokenHash: "",
    expiresAt: branch.expiresAt,
  };
}

export function createDynamoBranchStore(
  config: DynamoBranchStoreConfig
): BranchStore {
  const client = new DynamoDBClient(config.clientConfig ?? {});
  const doc = DynamoDBDocumentClient.from(client);
  const tableName = config.tableName;

  return {
    async getBranch(branchId: string) {
      const r = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: toPk(branchId), sk: SK_METADATA },
        })
      );
      if (!r.Item) return null;
      return itemToBranch(r.Item as Record<string, unknown>);
    },

    async getRealmRoot(realmId: string) {
      const record = await this.getRealmRootRecord(realmId);
      if (!record) return null;
      return this.getBranchRoot(record.branchId);
    },

    async getRealmRootRecord(realmId: string) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: {
            ":pk": realmPk(realmId),
            ":sk": SK_REALM,
          },
          Limit: 1,
          ConsistentRead: true,
        })
      );
      const item = r.Items?.[0] as Record<string, unknown> | undefined;
      if (item?.rootBranchId) return { branchId: item.rootBranchId as string };

      const legacy = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": toGsi1Pk(realmId),
            ":sk": GSI1SK_ROOT,
          },
          Limit: 1,
        })
      );
      const legItem = legacy.Items?.[0] as Record<string, unknown> | undefined;
      if (!legItem) return null;
      const pk = legItem.pk as string;
      const branchId = pk.startsWith(PK_PREFIX) ? pk.slice(PK_PREFIX.length) : pk;
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { pk: realmPk(realmId), sk: SK_REALM, rootBranchId: branchId },
        })
      );
      return { branchId };
    },

    async setRealmRoot(realmId: string, nodeKey: string) {
      const record = await this.getRealmRootRecord(realmId);
      if (!record) throw new Error("Realm root record not found");
      await this.setBranchRoot(record.branchId, nodeKey);
    },

    async ensureRealmRoot(realmId: string, emptyRootKey: string) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: {
            ":pk": realmPk(realmId),
            ":sk": SK_REALM,
          },
          Limit: 1,
        })
      );
      const existing = r.Items?.[0] as { rootBranchId?: string } | undefined;
      if (existing?.rootBranchId) {
        const branchId = existing.rootBranchId;
        const currentRoot = await this.getBranchRoot(branchId);
        if (currentRoot !== null) return;
        await this.setBranchRoot(branchId, emptyRootKey);
        return;
      }
      const legacy = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
          ExpressionAttributeValues: {
            ":pk": toGsi1Pk(realmId),
            ":sk": GSI1SK_ROOT,
          },
          Limit: 1,
        })
      );
      const legItem = legacy.Items?.[0] as Record<string, unknown> | undefined;
      if (legItem?.pk) {
        const pk = legItem.pk as string;
        const branchId = pk.startsWith(PK_PREFIX) ? pk.slice(PK_PREFIX.length) : pk;
        const currentRoot = await this.getBranchRoot(branchId);
        if (currentRoot !== null) {
          try {
            await doc.send(
              new PutCommand({
                TableName: tableName,
                Item: { pk: realmPk(realmId), sk: SK_REALM, rootBranchId: branchId },
                ConditionExpression: "attribute_not_exists(pk)",
              })
            );
          } catch {
            /* another writer wrote REALM row */
          }
          return;
        }
        try {
          await doc.send(
            new PutCommand({
              TableName: tableName,
              Item: { pk: realmPk(realmId), sk: SK_REALM, rootBranchId: branchId },
              ConditionExpression: "attribute_not_exists(pk)",
            })
          );
        } catch (e: unknown) {
          if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return;
          throw e;
        }
        await this.setBranchRoot(branchId, emptyRootKey);
        return;
      }
      const branchId = crypto.randomUUID();
      await this.insertBranch({
        branchId,
        realmId,
        parentId: null,
        mountPath: "",
        expiresAt: 0,
      });
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: { pk: realmPk(realmId), sk: SK_REALM, rootBranchId: branchId },
            ConditionExpression: "attribute_not_exists(pk)",
          })
        );
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return;
        throw e;
      }
      await this.setBranchRoot(branchId, emptyRootKey);
    },

    async getBranchRoot(branchId: string) {
      const r = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: toPk(branchId), sk: SK_ROOT },
        })
      );
      return (r.Item?.nodeKey as string) ?? null;
    },

    async setBranchRoot(branchId: string, nodeKey: string) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: toPk(branchId),
            sk: SK_ROOT,
            nodeKey,
          },
        })
      );
    },

    async listBranches(realmId: string) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": toGsi1Pk(realmId) },
        })
      );
      const list: Branch[] = [];
      for (const item of r.Items ?? []) {
        const row = item as Record<string, unknown>;
        if (row.sk !== SK_METADATA) continue;
        if (row.parentId === null || row.parentId === undefined) continue;
        list.push(itemToBranch(row));
      }
      return list;
    },

    async insertBranch(branch: Branch) {
      const item = branchToItem(branch) as Record<string, unknown> & {
        pk: string;
        sk: string;
        gsi1pk: string;
        gsi1sk: string;
      };
      item.pk = toPk(branch.branchId);
      item.sk = SK_METADATA;
      item.gsi1pk = toGsi1Pk(branch.realmId);
      item.gsi1sk = toGsi1Sk(branch.parentId);
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
        })
      );
    },

    async removeBranch(branchId: string) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: toPk(branchId), sk: SK_METADATA },
        })
      );
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: toPk(branchId), sk: SK_ROOT },
        })
      );
    },

    async purgeExpiredBranches(expiredBefore: number) {
      const r = await doc.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: "pk BETWEEN :pkStart AND :pkEnd AND #sk = :sk",
          ExpressionAttributeNames: { "#sk": "sk" },
          ExpressionAttributeValues: {
            ":pkStart": PK_PREFIX,
            ":pkEnd": `${PK_PREFIX}\uffff`,
            ":sk": SK_METADATA,
          },
        })
      );
      let count = 0;
      for (const item of r.Items ?? []) {
        const d = item as Record<string, unknown>;
        if (d.parentId === null || d.parentId === undefined) continue;
        const exp =
          d.lifetime === "limited"
            ? (d.expiresAt as number)
            : (d.accessExpiresAt as number);
        if (exp < expiredBefore) {
          const branchId = (d.delegateId as string) ?? (d.pk as string).slice(PK_PREFIX.length);
          await this.removeBranch(branchId);
          count++;
        }
      }
      return count;
    },
  };
}
