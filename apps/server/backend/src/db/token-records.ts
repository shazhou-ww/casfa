/**
 * Token Records database operations
 *
 * Manages individual token records (RT/AT) for the new delegate model.
 * Supports RT rotation with one-time-use and token family invalidation.
 *
 * Table: tokensTable (pk/sk schema)
 *   PK = TOKENREC#{tokenId}
 *   SK = METADATA
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Token record for the new delegate model
 *
 * Each RT/AT is stored as a separate record.
 * RT records track one-time-use state for rotation.
 */
export type TokenRecord = {
  /** Token ID: dlt1_xxx */
  tokenId: string;
  /** Token type */
  tokenType: "refresh" | "access";
  /** Delegate ID this token belongs to */
  delegateId: string;
  /** Realm */
  realm: string;
  /** Expiration (Unix epoch ms). 0 for RT (never expires independently) */
  expiresAt: number;
  /** Whether this RT has been used (for one-time-use rotation) */
  isUsed: boolean;
  /** Whether this token has been invalidated (token family invalidation) */
  isInvalidated: boolean;
  /** Token family ID — all RT/AT in a rotation chain share this */
  familyId: string;
  /** Creation timestamp (Unix epoch ms) */
  createdAt: number;
};

export type CreateTokenRecordInput = Omit<TokenRecord, "isUsed" | "isInvalidated" | "createdAt">;

export type TokenRecordsDb = {
  /** Create a new token record */
  create: (input: CreateTokenRecordInput) => Promise<void>;

  /** Get a token record by tokenId */
  get: (tokenId: string) => Promise<TokenRecord | null>;

  /**
   * Mark an RT as used (one-time-use).
   * Returns true if successfully marked, false if already used.
   * Uses conditional update to ensure atomicity.
   */
  markUsed: (tokenId: string) => Promise<boolean>;

  /**
   * Invalidate all tokens in a token family.
   * Used when RT replay is detected.
   */
  invalidateFamily: (familyId: string) => Promise<number>;

  /**
   * List all tokens for a delegate (for debugging/admin)
   */
  listByDelegate: (
    delegateId: string,
    options?: { limit?: number; cursor?: string },
  ) => Promise<{ tokens: TokenRecord[]; nextCursor?: string }>;
};

type TokenRecordsDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Key Helpers
// ============================================================================

const toTokenRecPk = (tokenId: string): string => `TOKENREC#${tokenId}`;
const METADATA_SK = "METADATA";
const toFamilyGsiPk = (familyId: string): string => `TOKFAM#${familyId}`;
const toDelegateGsiPk = (delegateId: string): string => `TOKDLG#${delegateId}`;

// ============================================================================
// Factory
// ============================================================================

export const createTokenRecordsDb = (config: TokenRecordsDbConfig): TokenRecordsDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  const toRecord = (item: Record<string, unknown>): TokenRecord => ({
    tokenId: item.tokenId as string,
    tokenType: item.tokenType as "refresh" | "access",
    delegateId: item.delegateId as string,
    realm: item.realm as string,
    expiresAt: item.expiresAt as number,
    isUsed: (item.isUsed as boolean) ?? false,
    isInvalidated: (item.isInvalidated as boolean) ?? false,
    familyId: item.familyId as string,
    createdAt: item.createdAt as number,
  });

  // --------------------------------------------------------------------------
  // Operations
  // --------------------------------------------------------------------------

  const create = async (input: CreateTokenRecordInput): Promise<void> => {
    const now = Date.now();
    const item: Record<string, unknown> = {
      pk: toTokenRecPk(input.tokenId),
      sk: METADATA_SK,
      tokenId: input.tokenId,
      tokenType: input.tokenType,
      delegateId: input.delegateId,
      realm: input.realm,
      expiresAt: input.expiresAt,
      isUsed: false,
      isInvalidated: false,
      familyId: input.familyId,
      createdAt: now,
      // GSI keys for family and delegate queries
      gsi1pk: toFamilyGsiPk(input.familyId),
      gsi1sk: `TOKENREC#${input.tokenId}`,
      gsi2pk: toDelegateGsiPk(input.delegateId),
      gsi2sk: `TOKENREC#${input.tokenId}`,
    };

    // Set TTL for AT records (auto-cleanup)
    if (input.tokenType === "access" && input.expiresAt > 0) {
      item.ttl = Math.floor(input.expiresAt / 1000) + 86400; // +1 day buffer
    }

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      }),
    );
  };

  const get = async (tokenId: string): Promise<TokenRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toTokenRecPk(tokenId), sk: METADATA_SK },
      }),
    );
    if (!result.Item) return null;
    return toRecord(result.Item as Record<string, unknown>);
  };

  const markUsed = async (tokenId: string): Promise<boolean> => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toTokenRecPk(tokenId), sk: METADATA_SK },
          UpdateExpression: "SET isUsed = :true",
          ConditionExpression:
            "attribute_exists(pk) AND isUsed = :false AND isInvalidated = :false",
          ExpressionAttributeValues: {
            ":true": true,
            ":false": false,
          },
        }),
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        return false;
      }
      throw error;
    }
  };

  const invalidateFamily = async (familyId: string): Promise<number> => {
    // Query all tokens in the family
    const queryResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": toFamilyGsiPk(familyId),
          ":prefix": "TOKENREC#",
        },
      }),
    );

    if (!queryResult.Items || queryResult.Items.length === 0) return 0;

    let count = 0;
    for (const item of queryResult.Items) {
      const tokenId = (item as Record<string, unknown>).tokenId as string;
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: toTokenRecPk(tokenId), sk: METADATA_SK },
            UpdateExpression: "SET isInvalidated = :true",
            ConditionExpression: "isInvalidated = :false",
            ExpressionAttributeValues: {
              ":true": true,
              ":false": false,
            },
          }),
        );
        count++;
      } catch (error: unknown) {
        const err = error as { name?: string };
        if (err.name !== "ConditionalCheckFailedException") {
          throw error;
        }
        // Already invalidated, skip
      }
    }
    return count;
  };

  const listByDelegate = async (
    delegateId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ tokens: TokenRecord[]; nextCursor?: string }> => {
    const limit = options?.limit ?? 100;

    const params: Record<string, unknown> = {
      TableName: tableName,
      IndexName: "gsi2",
      KeyConditionExpression: "gsi2pk = :pk AND begins_with(gsi2sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": toDelegateGsiPk(delegateId),
        ":prefix": "TOKENREC#",
      },
      Limit: limit,
    };

    if (options?.cursor) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(options.cursor, "base64").toString(),
      );
    }

    const result = await client.send(new QueryCommand(params as never));

    const tokens = (result.Items ?? []).map((item) =>
      toRecord(item as Record<string, unknown>),
    );

    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      nextCursor = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString("base64");
    }

    return { tokens, nextCursor };
  };

  return { create, get, markUsed, invalidateFamily, listByDelegate };
};
