/**
 * AWS Lambda entry: same app as index.ts, exported as handler for API Gateway HTTP API.
 * Used by Cell deploy (Lambda) and local dev (Bun). DB = DynamoDB, Blob = S3 (local uses Docker + MinIO).
 *
 * Normalizes path: API Gateway may pass rawPath with stage prefix (e.g. /dev/api/...).
 * We strip a leading /{stage}/ so that Hono routes like /api/realm/:id/files match.
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
import { createMemoryDerivedDataStore } from "./db/derived-data.ts";
import { createDynamoBranchStore } from "./db/dynamo-branch-store.ts";
import { createMemoryRealmUsageStore } from "./db/realm-usage-store.ts";
import { createMemoryUserSettingsStore } from "./db/user-settings.ts";
import { createCasFacade } from "./services/cas.ts";

const config = loadConfig();

// SSO mode: only JWT verification (region + userPoolId) is needed; clientId/hostedUiUrl are for legacy OAuth routes (not mounted).
const cognitoConfig: CognitoConfig = {
  region: config.auth.cognitoRegion ?? "us-east-1",
  userPoolId: config.auth.cognitoUserPoolId ?? "",
  clientId: config.ssoBaseUrl ? "" : (config.auth.cognitoClientId ?? ""),
  hostedUiUrl: config.ssoBaseUrl ? "" : (config.auth.cognitoHostedUiUrl ?? ""),
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
  permissions: [
    "use_mcp",
    "manage_delegates",
    "file_read",
    "file_write",
    "branch_manage",
    "delegate_manage",
  ],
});

const branchStore = createDynamoBranchStore({
  tableName: config.dynamodbTableRealms,
  clientConfig: config.dynamodbEndpoint
    ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
    : undefined,
});
const derivedDataStore = createMemoryDerivedDataStore();
const realmUsageStore = createMemoryRealmUsageStore();
const userSettingsStore = createMemoryUserSettingsStore();

const { cas, key } = createCasFacade(config);

const app = createApp({
  config,
  cas,
  key,
  branchStore,
  derivedDataStore,
  realmUsageStore,
  userSettingsStore,
  grantStore,
  oauthServer,
  pendingClientInfoStore,
});

const honoHandler = handle(app);

/** Strip leading /{stage}/ from rawPath so /dev/api/... becomes /api/... (API Gateway may prepend stage in Lambda event). */
function normalizeEventPath(event: { rawPath?: string }): void {
  const raw = event.rawPath;
  if (!raw || !raw.startsWith("/")) return;
  const segments = raw.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] !== "api" && segments[1] === "api") {
    (event as { rawPath: string }).rawPath = `/${segments.slice(1).join("/")}`;
  }
}

export const handler = async (event: unknown, context: unknown) => {
  if (event && typeof event === "object" && "rawPath" in event) {
    normalizeEventPath(event as { rawPath: string });
  }
  return honoHandler(
    event as Parameters<typeof honoHandler>[0],
    context as Parameters<typeof honoHandler>[1]
  );
};
