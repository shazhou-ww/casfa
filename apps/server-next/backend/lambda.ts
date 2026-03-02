/**
 * AWS Lambda entry: same app as index.ts, exported as handler for API Gateway HTTP API.
 * Used by Serverless Framework and serverless-offline.
 * DB = DynamoDB, Blob = S3 (local dev uses Docker DynamoDB + serverless-s3-local).
 *
 * Normalizes path: serverless-offline may pass rawPath with stage prefix (e.g. /dev/api/...).
 * We strip a leading /{stage}/ so that Hono routes like /api/realm/:id/files match.
 */
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDynamoDelegateGrantStore } from "./db/dynamo-delegate-grant-store.ts";
import { createDynamoBranchStore } from "./db/dynamo-branch-store.ts";
import { createMemoryDerivedDataStore } from "./db/derived-data.ts";
import { createMemoryUserSettingsStore } from "./db/user-settings.ts";
import { createCasFacade } from "./services/cas.ts";

const config = loadConfig();
const { cas, key } = createCasFacade(config);
const branchStore = createDynamoBranchStore({
  tableName: config.dynamodbTableDelegates,
  clientConfig: config.dynamodbEndpoint
    ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
    : undefined,
});
const delegateGrantStore = createDynamoDelegateGrantStore({
  tableName: config.dynamodbTableGrants,
  clientConfig: config.dynamodbEndpoint
    ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
    : undefined,
});
const derivedDataStore = createMemoryDerivedDataStore();
const userSettingsStore = createMemoryUserSettingsStore();

const app = createApp({
  config,
  cas,
  key,
  branchStore,
  delegateGrantStore,
  derivedDataStore,
  userSettingsStore,
});

const honoHandler = handle(app);

/** Strip leading /{stage}/ from rawPath so /dev/api/... becomes /api/... (serverless-offline may prepend stage in Lambda event). */
function normalizeEventPath(event: { rawPath?: string }): void {
  const raw = event.rawPath;
  if (!raw || !raw.startsWith("/")) return;
  const segments = raw.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] !== "api" && segments[1] === "api") {
    (event as { rawPath: string }).rawPath = "/" + segments.slice(1).join("/");
  }
}

export const handler = async (event: unknown, context: unknown) => {
  if (event && typeof event === "object" && "rawPath" in event) {
    normalizeEventPath(event as { rawPath: string });
  }
  return honoHandler(event as Parameters<typeof honoHandler>[0], context as Parameters<typeof honoHandler>[1]);
};
