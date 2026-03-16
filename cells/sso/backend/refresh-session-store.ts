import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

export type RefreshSession = {
  refreshToken: string;
  expiresAt?: number;
};

export type RefreshSessionStore = {
  putByHandle: (handle: string, session: RefreshSession) => Promise<void>;
  getByHandle: (handle: string) => Promise<RefreshSession | null>;
  removeByHandle: (handle: string) => Promise<void>;
};

const REFRESH_PK_PREFIX = "REFRESH#";
const REFRESH_SK = "METADATA";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createPk(handleHash: string): string {
  return `${REFRESH_PK_PREFIX}${handleHash}`;
}

function isExpired(expiresAt: number | undefined): boolean {
  return typeof expiresAt === "number" && expiresAt <= nowSeconds();
}

export function createMemoryRefreshSessionStore(): RefreshSessionStore {
  const map = new Map<string, RefreshSession>();
  return {
    async putByHandle(handle, session) {
      const hash = await sha256Hex(handle);
      map.set(hash, session);
    },
    async getByHandle(handle) {
      const hash = await sha256Hex(handle);
      const session = map.get(hash) ?? null;
      if (!session) return null;
      if (isExpired(session.expiresAt)) {
        map.delete(hash);
        return null;
      }
      return session;
    },
    async removeByHandle(handle) {
      const hash = await sha256Hex(handle);
      map.delete(hash);
    },
  };
}

export function createDynamoRefreshSessionStore(params: {
  tableName: string;
  client: DynamoDBDocumentClient;
}): RefreshSessionStore {
  const { tableName, client } = params;
  return {
    async putByHandle(handle, session) {
      const handleHash = await sha256Hex(handle);
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: createPk(handleHash),
            sk: REFRESH_SK,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt,
            updatedAt: nowSeconds(),
          },
        })
      );
    },
    async getByHandle(handle) {
      const handleHash = await sha256Hex(handle);
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: createPk(handleHash),
            sk: REFRESH_SK,
          },
        })
      );
      const item = result.Item as
        | {
            refreshToken?: string;
            expiresAt?: number;
          }
        | undefined;
      if (!item?.refreshToken) return null;
      if (isExpired(item.expiresAt)) return null;
      return {
        refreshToken: item.refreshToken,
        expiresAt: item.expiresAt,
      };
    },
    async removeByHandle(handle) {
      const handleHash = await sha256Hex(handle);
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            pk: createPk(handleHash),
            sk: REFRESH_SK,
          },
        })
      );
    },
  };
}
