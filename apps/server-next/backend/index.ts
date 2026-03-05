/**
 * Local HTTP server (bun run backend/index.ts). DB = DynamoDB, Blob = S3.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito";
import { createDynamoGrantStore, createOAuthServer } from "@casfa/cell-oauth";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDynamoDelegateGrantStore } from "./db/dynamo-delegate-grant-store.ts";
import { createDynamoBranchStore } from "./db/dynamo-branch-store.ts";
import { createMemoryDerivedDataStore } from "./db/derived-data.ts";
import { createMemoryRealmUsageStore } from "./db/realm-usage-store.ts";
import { createMemoryUserSettingsStore } from "./db/user-settings.ts";
import { createCasFacade } from "./services/cas.ts";

const config = loadConfig();

const cognitoConfig: CognitoConfig = {
  region: config.auth.cognitoRegion ?? "us-east-1",
  userPoolId: config.auth.cognitoUserPoolId ?? "",
  clientId: config.auth.cognitoClientId ?? "",
  hostedUiUrl: config.auth.cognitoHostedUiUrl ?? "",
};

const dynamoClient = new DynamoDBClient(
  config.dynamodbEndpoint
    ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
    : {},
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const grantStore = createDynamoGrantStore({
  tableName: config.dynamodbTableGrants,
  client: docClient,
});

const jwtVerifier = config.auth.mockJwtSecret
  ? createMockJwtVerifier(config.auth.mockJwtSecret)
  : createCognitoJwtVerifier({
      region: cognitoConfig.region,
      userPoolId: cognitoConfig.userPoolId,
    });

const oauthServer = createOAuthServer({
  issuerUrl: config.apiBaseUrl ?? process.env.APP_ORIGIN ?? "",
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: [
    "use_mcp",
    "manage_delegates",
    "file_read",
    "file_write",
    "branch_manage",
    "delegate_manage",
  ],
});

const { cas, key } = createCasFacade(config);
const branchStore = createDynamoBranchStore({
  tableName: config.dynamodbTableRealms,
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
const realmUsageStore = createMemoryRealmUsageStore();
const userSettingsStore = createMemoryUserSettingsStore();
const app = createApp({
  config,
  cas,
  key,
  branchStore,
  delegateGrantStore,
  derivedDataStore,
  realmUsageStore,
  userSettingsStore,
  oauthServer,
});
Bun.serve({ port: config.port, fetch: app.fetch });
