/**
 * DynamoDB-backed message store.
 * pk = THREAD#threadId, sk = MSG#<createdAt>#messageId (createdAt zero-padded for ascending order)
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Message, MessageContentPart } from "../types.ts";

const THREAD_PK_PREFIX = "THREAD#";
const MSG_SK_PREFIX = "MSG#";

function threadPk(threadId: string): string {
  return `${THREAD_PK_PREFIX}${threadId}`;
}

function msgSk(createdAt: number, messageId: string): string {
  const pad = String(createdAt).padStart(15, "0");
  return `${MSG_SK_PREFIX}${pad}#${messageId}`;
}

function itemToMessage(item: Record<string, unknown>): Message {
  return {
    messageId: item.messageId as string,
    threadId: item.threadId as string,
    role: item.role as Message["role"],
    content: (item.content as MessageContentPart[]) ?? [],
    createdAt: item.createdAt as number,
    modelId: item.modelId as string | undefined,
  };
}

export type MessageStoreConfig = {
  tableName: string;
  doc: DynamoDBDocumentClient;
};

export type MessageStore = {
  list(threadId: string, limit?: number, cursor?: string): Promise<{ items: Message[]; nextCursor?: string }>;
  create(threadId: string, input: { role: Message["role"]; content: MessageContentPart[]; modelId?: string }): Promise<Message>;
  deleteByThread(threadId: string): Promise<void>;
};

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessageStore(config: MessageStoreConfig): MessageStore {
  const { tableName, doc } = config;

  return {
    async list(threadId, limit = 100, cursor) {
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": threadPk(threadId),
            ":skPrefix": MSG_SK_PREFIX,
          },
          Limit: limit,
          ScanIndexForward: true,
          ExclusiveStartKey: cursor ? (JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>) : undefined,
        })
      );
      const items = (r.Items ?? []).map((i) => itemToMessage(i as Record<string, unknown>));
      const nextCursor = r.LastEvaluatedKey ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64url") : undefined;
      return { items, nextCursor };
    },

    async create(threadId, input) {
      const now = Date.now();
      const messageId = generateMessageId();
      const message: Message = {
        messageId,
        threadId,
        role: input.role,
        content: input.content,
        createdAt: now,
        modelId: input.modelId,
      };
      const item = {
        pk: threadPk(threadId),
        sk: msgSk(now, messageId),
        ...message,
      };
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return message;
    },

    async deleteByThread(threadId) {
      const pk = threadPk(threadId);
      let cursor: Record<string, unknown> | undefined;
      do {
        const r = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
            ExpressionAttributeValues: { ":pk": pk, ":skPrefix": MSG_SK_PREFIX },
            ExclusiveStartKey: cursor,
          })
        );
        const items = r.Items ?? [];
        for (let i = 0; i < items.length; i += 25) {
          const chunk = items.slice(i, i + 25);
          await doc.send(
            new BatchWriteCommand({
              RequestItems: {
                [tableName]: chunk.map((item) => ({
                  DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
                })),
              },
            })
          );
        }
        cursor = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (cursor);
    },
  };
}
