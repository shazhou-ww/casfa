/**
 * AWS Lambda entry for Artist MCP (Streamable HTTP).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { handle } from "hono/aws-lambda";
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

const honoHandler = handle(app);

/** Strip path prefix so /artist/api/... becomes /api/... (platform single-domain path). */
function normalizeEventPath(event: { rawPath?: string }): void {
  const raw = event.rawPath;
  if (!raw || !raw.startsWith("/")) return;
  const segments = raw.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] !== "api" && segments[0] !== "oauth") {
    const second = segments[1];
    if (second === "api" || second === "oauth" || second === ".well-known") {
      (event as { rawPath: string }).rawPath = `/${segments.slice(1).join("/")}`;
    }
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
