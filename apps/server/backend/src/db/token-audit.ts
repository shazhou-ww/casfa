/**
 * TokenAudit database operations
 *
 * Manages audit logs for token operations.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type {
  TokenAuditRecord,
  CreateTokenAuditInput,
  ListOptions,
  PaginatedResult,
} from "../types/delegate-token.ts";
import {
  toAuditPk,
  toAuditSk,
  toAuditDate,
  toAuditGsi4Pk,
  toAuditGsi4Sk,
  toAuditTtl,
  encodeCursor,
  decodeCursor,
} from "../util/db-keys.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenAuditDb = {
  /**
   * Log a token operation
   */
  log: (input: CreateTokenAuditInput) => Promise<TokenAuditRecord>;

  /**
   * List audit logs for a specific token
   */
  listByToken: (
    tokenId: string,
    options?: ListOptions
  ) => Promise<PaginatedResult<TokenAuditRecord>>;

  /**
   * List audit logs by date
   */
  listByDate: (
    date: string,
    options?: ListOptions & { startTime?: number; endTime?: number }
  ) => Promise<PaginatedResult<TokenAuditRecord>>;
};

type TokenAuditDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createTokenAuditDb = (config: TokenAuditDbConfig): TokenAuditDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const log = async (input: CreateTokenAuditInput): Promise<TokenAuditRecord> => {
    const timestamp = Date.now();
    const date = toAuditDate(timestamp);

    const record: TokenAuditRecord = {
      // Primary key
      pk: toAuditPk(input.tokenId),
      sk: toAuditSk(timestamp, input.action),

      // Audit fields
      tokenId: input.tokenId,
      action: input.action,
      actorId: input.actorId,
      actorType: input.actorType,
      timestamp,
      details: input.details,

      // GSI keys
      gsi4pk: toAuditGsi4Pk(date),
      gsi4sk: toAuditGsi4Sk(timestamp, input.tokenId),

      // TTL (90 days)
      ttl: toAuditTtl(timestamp),
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: record,
      })
    );

    return record;
  };

  const listByToken = async (
    tokenId: string,
    options?: ListOptions
  ): Promise<PaginatedResult<TokenAuditRecord>> => {
    const limit = options?.limit ?? 100;

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": toAuditPk(tokenId),
        },
        Limit: limit + 1,
        ExclusiveStartKey: options?.cursor ? decodeCursor(options.cursor) : undefined,
        ScanIndexForward: false, // Newest first
      })
    );

    const items = (result.Items ?? []) as TokenAuditRecord[];
    const hasMore = items.length > limit;
    const logs = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey) {
      nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return { items: logs, nextCursor, hasMore };
  };

  const listByDate = async (
    date: string,
    options?: ListOptions & { startTime?: number; endTime?: number }
  ): Promise<PaginatedResult<TokenAuditRecord>> => {
    const limit = options?.limit ?? 100;

    // Build key condition for time range
    let keyCondition = "gsi4pk = :pk";
    const expressionValues: Record<string, unknown> = {
      ":pk": toAuditGsi4Pk(date),
    };

    if (options?.startTime && options?.endTime) {
      keyCondition += " AND gsi4sk BETWEEN :start AND :end";
      expressionValues[":start"] = options.startTime.toString().padStart(13, "0");
      expressionValues[":end"] = options.endTime.toString().padStart(13, "0") + "~"; // ~ is after all tokenIds
    } else if (options?.startTime) {
      keyCondition += " AND gsi4sk >= :start";
      expressionValues[":start"] = options.startTime.toString().padStart(13, "0");
    } else if (options?.endTime) {
      keyCondition += " AND gsi4sk <= :end";
      expressionValues[":end"] = options.endTime.toString().padStart(13, "0") + "~";
    }

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi4",
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
        Limit: limit + 1,
        ExclusiveStartKey: options?.cursor ? decodeCursor(options.cursor) : undefined,
        ScanIndexForward: false, // Newest first
      })
    );

    // gsi4 is KEYS_ONLY, so we get minimal data
    // For full audit records, we'd need to fetch from main table
    // For now, return the key information
    const items = (result.Items ?? []) as TokenAuditRecord[];
    const hasMore = items.length > limit;
    const logs = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey) {
      nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return { items: logs, nextCursor, hasMore };
  };

  return {
    log,
    listByToken,
    listByDate,
  };
};
