/**
 * Ticket database operations
 *
 * Manages Ticket workspace records. Tickets are stored in the realm table
 * with primary key realm + key (where key = TICKET#{ticketId}).
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  TicketRecord,
  CreateTicketInput,
  ListOptions,
  PaginatedResult,
} from "../types/delegate-token.ts";
import {
  toTicketSk,
  toTicketTtl,
  encodeCursor,
  decodeCursor,
} from "../util/db-keys.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type TicketsDb = {
  /**
   * Create a new Ticket
   */
  create: (input: CreateTicketInput) => Promise<TicketRecord>;

  /**
   * Get a ticket by realm and ticketId
   */
  get: (realm: string, ticketId: string) => Promise<TicketRecord | null>;

  /**
   * Submit a ticket (update status and set root)
   */
  submit: (realm: string, ticketId: string, root: string) => Promise<TicketRecord | null>;

  /**
   * List tickets by realm
   */
  listByRealm: (
    realm: string,
    options?: ListOptions & { status?: "pending" | "submitted" }
  ) => Promise<PaginatedResult<TicketRecord>>;

  /**
   * List tickets created by a specific token
   */
  listByCreator: (
    creatorTokenId: string,
    realm: string,
    options?: ListOptions
  ) => Promise<PaginatedResult<TicketRecord>>;

  /**
   * Delete a ticket
   */
  delete: (realm: string, ticketId: string) => Promise<boolean>;
};

type TicketsDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createTicketsDb = (config: TicketsDbConfig): TicketsDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const create = async (input: CreateTicketInput): Promise<TicketRecord> => {
    const now = Date.now();

    const record: TicketRecord = {
      // Primary key (use realm table key format: realm + key)
      pk: input.realm,
      sk: toTicketSk(input.ticketId),

      // Ticket fields from input
      ticketId: input.ticketId,
      realm: input.realm,
      title: input.title,
      accessTokenId: input.accessTokenId,
      creatorIssuerId: input.creatorIssuerId,

      // Status
      status: "pending",

      // Timestamps
      createdAt: now,

      // TTL (24 hours from creation)
      ttl: toTicketTtl(now),
    };

    // Store with realm table key format
    const item = {
      realm: input.realm,
      key: toTicketSk(input.ticketId),
      ...record,
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(#realm) OR attribute_not_exists(#key)",
        ExpressionAttributeNames: {
          "#realm": "realm",
          "#key": "key",
        },
      })
    );

    return record;
  };

  const get = async (realm: string, ticketId: string): Promise<TicketRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { realm, key: toTicketSk(ticketId) },
      })
    );

    if (!result.Item) return null;
    return result.Item as TicketRecord;
  };

  const submit = async (
    realm: string,
    ticketId: string,
    root: string
  ): Promise<TicketRecord | null> => {
    const now = Date.now();

    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { realm, key: toTicketSk(ticketId) },
          UpdateExpression: "SET #status = :submitted, #root = :root, submittedAt = :now",
          ConditionExpression: "attribute_exists(#realm) AND #status = :pending",
          ExpressionAttributeNames: {
            "#status": "status",
            "#root": "root",
            "#realm": "realm",
          },
          ExpressionAttributeValues: {
            ":submitted": "submitted",
            ":pending": "pending",
            ":root": root,
            ":now": now,
          },
          ReturnValues: "ALL_NEW",
        })
      );

      return result.Attributes as TicketRecord;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") {
        // Ticket not found or already submitted
        return null;
      }
      throw error;
    }
  };

  const listByRealm = async (
    realm: string,
    options?: ListOptions & { status?: "pending" | "submitted" }
  ): Promise<PaginatedResult<TicketRecord>> => {
    const limit = options?.limit ?? 100;

    const filterExpressions: string[] = [];
    const expressionValues: Record<string, unknown> = {
      ":realm": realm,
      ":prefix": "TICKET#",
    };

    if (options?.status) {
      filterExpressions.push("#status = :status");
      expressionValues[":status"] = options.status;
    }

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#realm = :realm AND begins_with(#key, :prefix)",
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(" AND ") : undefined,
        ExpressionAttributeNames: {
          "#realm": "realm",
          "#key": "key",
          ...(filterExpressions.length > 0 ? { "#status": "status" } : {}),
        },
        ExpressionAttributeValues: expressionValues,
        Limit: limit + 1,
        ExclusiveStartKey: options?.cursor ? decodeCursor(options.cursor) : undefined,
        ScanIndexForward: false, // Newest first
      })
    );

    const items = (result.Items ?? []) as TicketRecord[];
    const hasMore = items.length > limit;
    const tickets = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey) {
      nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return { items: tickets, nextCursor, hasMore };
  };

  const listByCreator = async (
    creatorTokenId: string,
    realm: string,
    options?: ListOptions
  ): Promise<PaginatedResult<TicketRecord>> => {
    const limit = options?.limit ?? 100;

    // Query by realm and filter by creatorTokenId
    // Note: For large datasets, consider adding a GSI for creatorTokenId
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#realm = :realm AND begins_with(#key, :prefix)",
        FilterExpression: "creatorIssuerId = :creatorId",
        ExpressionAttributeNames: {
          "#realm": "realm",
          "#key": "key",
        },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": "TICKET#",
          ":creatorId": creatorTokenId,
        },
        Limit: limit + 1,
        ExclusiveStartKey: options?.cursor ? decodeCursor(options.cursor) : undefined,
        ScanIndexForward: false,
      })
    );

    const items = (result.Items ?? []) as TicketRecord[];
    const hasMore = items.length > limit;
    const tickets = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey) {
      nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return { items: tickets, nextCursor, hasMore };
  };

  const deleteTicket = async (realm: string, ticketId: string): Promise<boolean> => {
    try {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { realm, key: toTicketSk(ticketId) },
          ConditionExpression: "attribute_exists(#realm)",
          ExpressionAttributeNames: {
            "#realm": "realm",
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

  return {
    create,
    get,
    submit,
    listByRealm,
    listByCreator,
    delete: deleteTicket,
  };
};
