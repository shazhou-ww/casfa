/**
 * Reference count database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { GcStatus, RefCount } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type RefCountDb = {
  getRefCount: (realm: string, key: string) => Promise<RefCount | null>;
  incrementRef: (
    realm: string,
    key: string,
    physicalSize: number,
    logicalSize: number
  ) => Promise<{ isNewToRealm: boolean }>;
  decrementRef: (realm: string, key: string) => Promise<{ newCount: number; deleted: boolean }>;
};

type RefCountDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createRefCountDb = (config: RefCountDbConfig): RefCountDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const getRefCount = async (realm: string, key: string): Promise<RefCount | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: realm, sk: `REF#${key}` },
      })
    );
    if (!result.Item) return null;

    return {
      realm: result.Item.pk,
      key: result.Item.sk.slice(4), // Remove "REF#"
      count: result.Item.count,
      physicalSize: result.Item.physicalSize,
      logicalSize: result.Item.logicalSize,
      gcStatus: result.Item.gcStatus,
      createdAt: result.Item.createdAt,
    };
  };

  const incrementRef = async (
    realm: string,
    key: string,
    physicalSize: number,
    logicalSize: number
  ): Promise<{ isNewToRealm: boolean }> => {
    const now = Date.now();

    try {
      // Try to increment existing record
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: realm, sk: `REF#${key}` },
          UpdateExpression: "SET #count = #count + :one, gcStatus = :active",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: {
            ":one": 1,
            ":active": "active" as GcStatus,
          },
        })
      );
      return { isNewToRealm: false };
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name !== "ConditionalCheckFailedException") throw error;
    }

    // Create new record
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: realm,
          sk: `REF#${key}`,
          count: 1,
          physicalSize,
          logicalSize,
          gcStatus: "active" as GcStatus,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );

    return { isNewToRealm: true };
  };

  const decrementRef = async (
    realm: string,
    key: string
  ): Promise<{ newCount: number; deleted: boolean }> => {
    const now = Date.now();

    const result = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: realm, sk: `REF#${key}` },
        UpdateExpression: "SET #count = #count - :one",
        ConditionExpression: "attribute_exists(pk) AND #count > :zero",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":zero": 0,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const newCount = result.Attributes?.count ?? 0;

    // If count reached 0, mark as pending for GC
    if (newCount === 0) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: realm, sk: `REF#${key}` },
          UpdateExpression: "SET gcStatus = :pending, pendingSince = :now",
          ExpressionAttributeValues: {
            ":pending": "pending" as GcStatus,
            ":now": now,
          },
        })
      );
    }

    return { newCount, deleted: newCount === 0 };
  };

  return {
    getRefCount,
    incrementRef,
    decrementRef,
  };
};
