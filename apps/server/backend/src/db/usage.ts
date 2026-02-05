/**
 * Usage statistics database operations
 *
 * Manages realm usage statistics and user quotas.
 *
 * Updated for DelegateToken refactor:
 * - Added UserQuota support for tracking resource counts
 * - Added methods for incrementing/decrementing resource counts
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RealmUsage } from "../types.ts";
import type { UserQuotaRecord } from "../types/delegate-token.ts";
import { toQuotaPk, toQuotaSk } from "../util/db-keys.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type ResourceType = "token" | "depot" | "ticket";

export type UsageDb = {
  // Existing methods (RealmUsage)
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

  // New methods (UserQuota)
  getUserQuota: (realm: string) => Promise<UserQuotaRecord>;
  updateUserQuota: (realm: string, updates: Partial<UserQuotaRecord>) => Promise<void>;
  incrementResourceCount: (realm: string, resource: ResourceType, delta?: number) => Promise<void>;
  decrementResourceCount: (realm: string, resource: ResourceType, delta?: number) => Promise<void>;
  updateBytesInProgress: (realm: string, delta: number) => Promise<void>;
  checkResourceLimit: (
    realm: string,
    resource: ResourceType,
    limit: number
  ) => Promise<{ allowed: boolean; currentCount: number }>;
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

  // ============================================================================
  // RealmUsage Methods (Existing)
  // ============================================================================

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

  // ============================================================================
  // UserQuota Methods (New)
  // ============================================================================

  const defaultUserQuota = (realm: string): UserQuotaRecord => ({
    pk: toQuotaPk(realm),
    sk: toQuotaSk(),
    realm,
    quotaLimit: 0,
    bytesUsed: 0,
    bytesInProgress: 0,
    tokenCount: 0,
    depotCount: 0,
    ticketCount: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  });

  const getUserQuota = async (realm: string): Promise<UserQuotaRecord> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toQuotaPk(realm), sk: toQuotaSk() },
      })
    );

    if (!result.Item) {
      return defaultUserQuota(realm);
    }

    return {
      pk: result.Item.pk,
      sk: result.Item.sk,
      realm: result.Item.realm ?? realm,
      quotaLimit: result.Item.quotaLimit ?? 0,
      bytesUsed: result.Item.bytesUsed ?? 0,
      bytesInProgress: result.Item.bytesInProgress ?? 0,
      tokenCount: result.Item.tokenCount ?? 0,
      depotCount: result.Item.depotCount ?? 0,
      ticketCount: result.Item.ticketCount ?? 0,
      createdAt: result.Item.createdAt ?? Date.now(),
      lastUpdated: result.Item.lastUpdated ?? Date.now(),
    };
  };

  const updateUserQuota = async (
    realm: string,
    updates: Partial<UserQuotaRecord>
  ): Promise<void> => {
    const now = Date.now();

    const updateExpressions: string[] = ["lastUpdated = :now"];
    const values: Record<string, unknown> = { ":now": now };

    if (updates.quotaLimit !== undefined) {
      updateExpressions.push("quotaLimit = :quotaLimit");
      values[":quotaLimit"] = updates.quotaLimit;
    }

    if (updates.bytesUsed !== undefined) {
      updateExpressions.push("bytesUsed = :bytesUsed");
      values[":bytesUsed"] = updates.bytesUsed;
    }

    if (updates.bytesInProgress !== undefined) {
      updateExpressions.push("bytesInProgress = :bytesInProgress");
      values[":bytesInProgress"] = updates.bytesInProgress;
    }

    if (updates.tokenCount !== undefined) {
      updateExpressions.push("tokenCount = :tokenCount");
      values[":tokenCount"] = updates.tokenCount;
    }

    if (updates.depotCount !== undefined) {
      updateExpressions.push("depotCount = :depotCount");
      values[":depotCount"] = updates.depotCount;
    }

    if (updates.ticketCount !== undefined) {
      updateExpressions.push("ticketCount = :ticketCount");
      values[":ticketCount"] = updates.ticketCount;
    }

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toQuotaPk(realm), sk: toQuotaSk() },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeValues: values,
      })
    );
  };

  const getResourceCountField = (resource: ResourceType): string => {
    switch (resource) {
      case "token":
        return "tokenCount";
      case "depot":
        return "depotCount";
      case "ticket":
        return "ticketCount";
    }
  };

  const incrementResourceCount = async (
    realm: string,
    resource: ResourceType,
    delta: number = 1
  ): Promise<void> => {
    const now = Date.now();
    const field = getResourceCountField(resource);

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toQuotaPk(realm), sk: toQuotaSk() },
        UpdateExpression: `SET ${field} = if_not_exists(${field}, :zero) + :delta, lastUpdated = :now, realm = if_not_exists(realm, :realm), createdAt = if_not_exists(createdAt, :now)`,
        ExpressionAttributeValues: {
          ":delta": delta,
          ":zero": 0,
          ":now": now,
          ":realm": realm,
        },
      })
    );
  };

  const decrementResourceCount = async (
    realm: string,
    resource: ResourceType,
    delta: number = 1
  ): Promise<void> => {
    const now = Date.now();
    const field = getResourceCountField(resource);

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toQuotaPk(realm), sk: toQuotaSk() },
        UpdateExpression: `SET ${field} = if_not_exists(${field}, :zero) - :delta, lastUpdated = :now`,
        ExpressionAttributeValues: {
          ":delta": delta,
          ":zero": 0,
          ":now": now,
        },
      })
    );
  };

  const updateBytesInProgress = async (realm: string, delta: number): Promise<void> => {
    const now = Date.now();

    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toQuotaPk(realm), sk: toQuotaSk() },
        UpdateExpression:
          "SET bytesInProgress = if_not_exists(bytesInProgress, :zero) + :delta, lastUpdated = :now",
        ExpressionAttributeValues: {
          ":delta": delta,
          ":zero": 0,
          ":now": now,
        },
      })
    );
  };

  const checkResourceLimit = async (
    realm: string,
    resource: ResourceType,
    limit: number
  ): Promise<{ allowed: boolean; currentCount: number }> => {
    const quota = await getUserQuota(realm);

    let currentCount: number;
    switch (resource) {
      case "token":
        currentCount = quota.tokenCount;
        break;
      case "depot":
        currentCount = quota.depotCount;
        break;
      case "ticket":
        currentCount = quota.ticketCount;
        break;
    }

    // If limit is 0, no limit is enforced
    if (limit === 0) {
      return { allowed: true, currentCount };
    }

    return { allowed: currentCount < limit, currentCount };
  };

  return {
    // Existing methods
    getUsage,
    updateUsage,
    checkQuota,
    setQuotaLimit,

    // New methods
    getUserQuota,
    updateUserQuota,
    incrementResourceCount,
    decrementResourceCount,
    updateBytesInProgress,
    checkResourceLimit,
  };
};
