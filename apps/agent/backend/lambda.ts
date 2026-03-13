/**
 * AWS Lambda entry: same app as dev-app, handler for API Gateway.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito-server";
import { createDynamoGrantStore, createDynamoPendingClientInfoStore } from "@casfa/cell-delegates-server";
import { createOAuthServer } from "@casfa/cell-cognito-server";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { isMockAuthEnabled, loadConfig } from "./config.ts";
import { createMessageStore } from "./db/message-store.ts";
import { createSettingsStore } from "./db/settings-store.ts";
import { createThreadStore } from "./db/thread-store.ts";

const config = loadConfig();

const cognitoConfig: CognitoConfig = {
  region: config.auth.cognitoRegion ?? "us-east-1",
  userPoolId: config.auth.cognitoUserPoolId ?? "",
  clientId: "",
  hostedUiUrl: "",
};

const dynamoClient = new DynamoDBClient(
  config.dynamodbEndpoint ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" } : {}
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const grantStore = createDynamoGrantStore({
  tableName: config.dynamodbTableGrants,
  client: docClient,
});

const pendingClientInfoStore = createDynamoPendingClientInfoStore({
  tableName: config.dynamodbTablePendingClientInfo,
  client: docClient,
});

const jwtVerifier = isMockAuthEnabled(config)
  ? createMockJwtVerifier(config.auth.mockJwtSecret!)
  : createCognitoJwtVerifier({
      region: cognitoConfig.region,
      userPoolId: cognitoConfig.userPoolId,
    });

const oauthServer = createOAuthServer({
  issuerUrl: config.baseUrl,
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: ["use_mcp", "manage_delegates"],
});

const threadStore = createThreadStore({
  tableName: config.dynamodbTableThreads,
  doc: docClient,
});
const messageStore = createMessageStore({
  tableName: config.dynamodbTableMessages,
  doc: docClient,
});
const settingsStore = createSettingsStore({
  tableName: config.dynamodbTableSettings,
  doc: docClient,
});

const app = createApp({
  config,
  oauthServer,
  pendingClientInfoStore,
  threadStore,
  messageStore,
  settingsStore,
});

const honoHandler = handle(app);

function resolveMountPrefix(baseUrl: string): string {
  try {
    const p = new URL(baseUrl).pathname.replace(/\/$/, "");
    return p || "";
  } catch {
    return "";
  }
}

function normalizeEventPath(event: { rawPath?: string }, mountPrefix: string): void {
  const raw = event.rawPath;
  if (!raw || !raw.startsWith("/")) return;
  if (mountPrefix && (raw === mountPrefix || raw.startsWith(`${mountPrefix}/`))) {
    const normalized = raw.slice(mountPrefix.length) || "/";
    (event as { rawPath: string }).rawPath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
}

export const handler = async (event: unknown, context: unknown) => {
  const mountPrefix = resolveMountPrefix(config.baseUrl);
  if (event && typeof event === "object" && "rawPath" in event) {
    normalizeEventPath(event as { rawPath: string }, mountPrefix);
  }
  return honoHandler(
    event as Parameters<typeof honoHandler>[0],
    context as Parameters<typeof honoHandler>[1]
  );
};
