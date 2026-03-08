/**
 * Entry for cell dev: exports app for Bun.serve. Bootstrap same as lambda; env from cell dev.
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

export { app };
