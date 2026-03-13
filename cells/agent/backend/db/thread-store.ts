/**
 * DynamoDB-backed thread store.
 * pk = REALM#realmId, sk = THREAD#threadId
 * GSI thread-list: gsi1pk = REALM#realmId, gsi1sk = THREAD#<updatedAt>#threadId (updatedAt zero-padded for sort)
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { Thread } from "../types.ts";

const REALM_PK_PREFIX = "REALM#";
const THREAD_SK_PREFIX = "THREAD#";
const GSI1_NAME = "thread-list";
const GSI1PK_PREFIX = "REALM#";
const GSI1SK_PREFIX = "THREAD#";

function realmPk(realmId: string): string {
  return `${REALM_PK_PREFIX}${realmId}`;
}

function threadSk(threadId: string): string {
  return `${THREAD_SK_PREFIX}${threadId}`;
}

/** Zero-pad updatedAt to 15 digits for string sort order = numeric order. */
function gsi1Sk(updatedAt: number, threadId: string): string {
  const pad = String(updatedAt).padStart(15, "0");
  return `${GSI1SK_PREFIX}${pad}#${threadId}`;
}

function itemToThread(item: Record<string, unknown>): Thread {
  return {
    threadId: item.threadId as string,
    title: (item.title as string) ?? "",
    createdAt: item.createdAt as number,
    updatedAt: item.updatedAt as number,
  };
}

export type ThreadStoreConfig = {
  tableName: string;
  doc: DynamoDBDocumentClient;
};

export type ThreadStore = {
  list(realmId: string, limit?: number, cursor?: string): Promise<{ items: Thread[]; nextCursor?: string }>;
  get(realmId: string, threadId: string): Promise<Thread | null>;
  create(realmId: string, input: { title: string }): Promise<Thread>;
  update(realmId: string, threadId: string, input: Partial<Pick<Thread, "title">>): Promise<Thread | null>;
  delete(realmId: string, threadId: string): Promise<void>;
};

function generateThreadId(): string {
  return `thr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createThreadStore(config: ThreadStoreConfig): ThreadStore {
  const { tableName, doc } = config;

  return {
    async list(realmId, limit = 50, cursor) {
      const pk = `${GSI1PK_PREFIX}${realmId}`;
      const r = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": pk },
          Limit: limit,
          ScanIndexForward: false,
          ExclusiveStartKey: cursor ? (JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>) : undefined,
        })
      );
      const items = (r.Items ?? []).map((i) => itemToThread(i as Record<string, unknown>));
      const nextCursor = r.LastEvaluatedKey ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64url") : undefined;
      return { items, nextCursor };
    },

    async get(realmId, threadId) {
      const r = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: realmPk(realmId), sk: threadSk(threadId) },
        })
      );
      if (!r.Item) return null;
      return itemToThread(r.Item as Record<string, unknown>);
    },

    async create(realmId, input) {
      const now = Date.now();
      const threadId = generateThreadId();
      const thread: Thread = {
        threadId,
        title: input.title,
        createdAt: now,
        updatedAt: now,
      };
      const item = {
        pk: realmPk(realmId),
        sk: threadSk(threadId),
        gsi1pk: `${GSI1PK_PREFIX}${realmId}`,
        gsi1sk: gsi1Sk(now, threadId),
        ...thread,
      };
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return thread;
    },

    async update(realmId, threadId, input) {
      const existing = await this.get(realmId, threadId);
      if (!existing) return null;
      const now = Date.now();
      const thread: Thread = {
        ...existing,
        ...input,
        updatedAt: now,
      };
      const item = {
        pk: realmPk(realmId),
        sk: threadSk(threadId),
        gsi1pk: `${GSI1PK_PREFIX}${realmId}`,
        gsi1sk: gsi1Sk(now, threadId),
        ...thread,
      };
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return thread;
    },

    async delete(realmId, threadId) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: realmPk(realmId), sk: threadSk(threadId) },
        })
      );
    },
  };
}
