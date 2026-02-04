/**
 * Usage statistics database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RealmUsage } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type UsageDb = {
  getUsage: (realm: string) => Promise<RealmUsage>;
  updateUsage: (
    realm: string,
    delta: { physicalBytes?: number; logicalBytes?: number; nodeCount?: number }
  ) => Promise<void>;
  checkQuota: (
    realm: string,
    additionalBytes: number
  ) => Promise<{ allowed: boolean; usage: RealmUsage }>;
  setQuotaLimit: (realm: string, quotaLimit: number) => Promise<void>;
};

type UsageDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createUsageDb = (config: UsageDbConfig): UsageDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const defaultUsage = (realm: string): RealmUsage => ({
    realm,
    physicalBytes: 0,
    logicalBytes: 0,
    nodeCount: 0,
    quotaLimit: 0,
    updatedAt: Date.now(),
  });

  const getUsage = async (realm: string): Promise<RealmUsage> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: realm, sk: "USAGE" },
      })
    );

    if (!result.Item) {
      return defaultUsage(realm);
    }

    return {
      realm: result.Item.pk,
      physicalBytes: result.Item.physicalBytes ?? 0,
      logicalBytes: result.Item.logicalBytes ?? 0,
      nodeCount: result.Item.nodeCount ?? 0,
      quotaLimit: result.Item.quotaLimit ?? 0,
      updatedAt: result.Item.updatedAt ?? Date.now(),
    };
  };

  const updateUsage = async (
    realm: string,
    delta: { physicalBytes?: number; logicalBytes?: number; nodeCount?: number }
  ): Promise<void> => {
    const now = Date.now();

    const updates: string[] = ["updatedAt = :now"];
    const values: Record<string, unknown> = { ":now": now };

    if (delta.physicalBytes !== undefined) {
      updates.push("physicalBytes = if_not_exists(physicalBytes, :zero) + :physical");
      values[":physical"] = delta.physicalBytes;
      values[":zero"] = 0;
    }

    if (delta.logicalBytes !== undefined) {
      updates.push("logicalBytes = if_not_exists(logicalBytes, :zero) + :logical");
      values[":logical"] = delta.logicalBytes;
      if (!values[":zero"]) values[":zero"] = 0;
    }

    if (delta.nodeCount !== undefined) {
      updates.push("nodeCount = if_not_exists(nodeCount, :zero) + :nodes");
      values[":nodes"] = delta.nodeCount;
      if (!values[":zero"]) values[":zero"] = 0;
    }

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: realm, sk: "USAGE" },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeValues: values,
      })
    );
  };

  const checkQuota = async (
    realm: string,
    additionalBytes: number
  ): Promise<{ allowed: boolean; usage: RealmUsage }> => {
    const usage = await getUsage(realm);

    // If no quota limit set, always allow
    if (usage.quotaLimit === 0) {
      return { allowed: true, usage };
    }

    const allowed = usage.physicalBytes + additionalBytes <= usage.quotaLimit;
    return { allowed, usage };
  };

  const setQuotaLimit = async (realm: string, quotaLimit: number): Promise<void> => {
    const now = Date.now();

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: realm, sk: "USAGE" },
        UpdateExpression: "SET quotaLimit = :limit, updatedAt = :now",
        ExpressionAttributeValues: {
          ":limit": quotaLimit,
          ":now": now,
        },
      })
    );
  };

  return {
    getUsage,
    updateUsage,
    checkQuota,
    setQuotaLimit,
  };
};
