/**
 * TokenRequest database operations
 *
 * Manages client authorization request records. Replaces the legacy ClientPending.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  TokenRequestRecord,
  CreateTokenRequestInput,
  ApproveTokenRequestConfig,
} from "../types/delegate-token.ts";
import { toTokenReqPk, toTokenReqSk, toTtl } from "../util/db-keys.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Constants
// ============================================================================

/** Default request expiration time (5 minutes) */
const DEFAULT_REQUEST_EXPIRES_IN = 5 * 60; // seconds

// ============================================================================
// Types
// ============================================================================

export type TokenRequestsDb = {
  /**
   * Create a new token request
   */
  create: (input: CreateTokenRequestInput) => Promise<TokenRequestRecord>;

  /**
   * Get a token request by ID
   */
  get: (requestId: string) => Promise<TokenRequestRecord | null>;

  /**
   * Approve a token request
   */
  approve: (
    requestId: string,
    approverId: string,
    config: ApproveTokenRequestConfig,
    approverTokenId?: string
  ) => Promise<TokenRequestRecord | null>;

  /**
   * Reject a token request
   */
  reject: (requestId: string) => Promise<boolean>;

  /**
   * Set the encrypted token after approval
   */
  setEncryptedToken: (requestId: string, encryptedToken: string) => Promise<void>;

  /**
   * Cleanup expired requests (manual cleanup, TTL handles most)
   */
  cleanupExpired: () => Promise<number>;
};

type TokenRequestsDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createTokenRequestsDb = (config: TokenRequestsDbConfig): TokenRequestsDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const create = async (input: CreateTokenRequestInput): Promise<TokenRequestRecord> => {
    const now = Date.now();
    const expiresIn = input.expiresIn ?? DEFAULT_REQUEST_EXPIRES_IN;
    const expiresAt = now + expiresIn * 1000;

    const record: TokenRequestRecord = {
      // Primary key
      pk: toTokenReqPk(input.requestId),
      sk: toTokenReqSk(),

      // Request fields
      requestId: input.requestId,
      clientName: input.clientName,
      clientSecretHash: input.clientSecretHash,

      // Status
      status: "pending",

      // Timestamps
      createdAt: now,
      expiresAt,

      // TTL
      ttl: toTtl(expiresAt),
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );

    return record;
  };

  const get = async (requestId: string): Promise<TokenRequestRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toTokenReqPk(requestId), sk: toTokenReqSk() },
      })
    );

    if (!result.Item) return null;
    return result.Item as TokenRequestRecord;
  };

  const approve = async (
    requestId: string,
    approverId: string,
    config: ApproveTokenRequestConfig,
    approverTokenId?: string
  ): Promise<TokenRequestRecord | null> => {
    const now = Date.now();

    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toTokenReqPk(requestId), sk: toTokenReqSk() },
          UpdateExpression: `
            SET #status = :approved,
                approvedAt = :now,
                approvedBy = :approver,
                realm = :realm,
                tokenType = :tokenType,
                depth = :depth,
                expiresIn = :expiresIn,
                canUpload = :canUpload,
                canManageDepot = :canManageDepot,
                #scope = :scope,
                tokenName = :tokenName,
                tokenDescription = :tokenDescription
                ${approverTokenId ? ", approverTokenId = :approverTokenId" : ""}
          `,
          ConditionExpression: "attribute_exists(pk) AND #status = :pending AND expiresAt > :now",
          ExpressionAttributeNames: {
            "#status": "status",
            "#scope": "scope",
          },
          ExpressionAttributeValues: {
            ":approved": "approved",
            ":pending": "pending",
            ":now": now,
            ":approver": approverId,
            ":realm": config.realm,
            ":tokenType": config.tokenType,
            ":depth": config.depth ?? 0,
            ":expiresIn": config.expiresIn ?? 86400, // Default 1 day
            ":canUpload": config.canUpload ?? false,
            ":canManageDepot": config.canManageDepot ?? false,
            ":scope": config.scope ?? [],
            ":tokenName": config.tokenName ?? null,
            ":tokenDescription": config.tokenDescription ?? null,
            ...(approverTokenId ? { ":approverTokenId": approverTokenId } : {}),
          },
          ReturnValues: "ALL_NEW",
        })
      );

      return result.Attributes as TokenRequestRecord;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Request not found, not pending, or expired
        return null;
      }
      throw error;
    }
  };

  const reject = async (requestId: string): Promise<boolean> => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toTokenReqPk(requestId), sk: toTokenReqSk() },
          UpdateExpression: "SET #status = :rejected",
          ConditionExpression: "attribute_exists(pk) AND #status = :pending",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":rejected": "rejected",
            ":pending": "pending",
          },
        })
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

  const setEncryptedToken = async (requestId: string, encryptedToken: string): Promise<void> => {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: toTokenReqPk(requestId), sk: toTokenReqSk() },
        UpdateExpression: "SET encryptedToken = :token",
        ConditionExpression: "attribute_exists(pk) AND #status = :approved",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":token": encryptedToken,
          ":approved": "approved",
        },
      })
    );
  };

  const cleanupExpired = async (): Promise<number> => {
    // Note: TTL handles automatic deletion, this is for manual cleanup if needed
    // Scan for expired pending requests and delete them
    const now = Date.now();
    let deletedCount = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await client.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression:
            "begins_with(pk, :prefix) AND #status = :pending AND expiresAt < :now",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":prefix": "TOKENREQ#",
            ":pending": "pending",
            ":now": now,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      for (const item of result.Items ?? []) {
        try {
          await client.send(
            new DeleteCommand({
              TableName: tableName,
              Key: { pk: item.pk, sk: item.sk },
            })
          );
          deletedCount++;
        } catch {
          // Ignore deletion errors
        }
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return deletedCount;
  };

  return {
    create,
    get,
    approve,
    reject,
    setEncryptedToken,
    cleanupExpired,
  };
};
