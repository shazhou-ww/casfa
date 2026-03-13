/**
 * Entry for cell dev: exports app so cell-cli can run Bun.serve({ fetch: app.fetch }).
 * Bootstrap is the same as lambda.ts; env vars are injected by cell dev.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito-server";
import { createOAuthServer } from "@casfa/cell-cognito-server";
import {
  createDynamoGrantStore,
  createDynamoPendingClientInfoStore,
} from "@casfa/cell-delegates-server";
import { createApp } from "./app.ts";
import { isMockAuthEnabled, loadConfig } from "./config.ts";

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

const app = createApp({
  config,
  grantStore,
  oauthServer,
  pendingClientInfoStore,
});

export { app };
