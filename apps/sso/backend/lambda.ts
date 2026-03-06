/**
 * AWS Lambda entry for SSO API. Normalizes path if API Gateway prepends stage.
 */
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito";
import { createDynamoGrantStore, createOAuthServer } from "@casfa/cell-oauth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const cognitoConfig: CognitoConfig = {
  region: config.cognito.region,
  userPoolId: config.cognito.userPoolId,
  clientId: config.cognito.clientId,
  hostedUiUrl: config.cognito.hostedUiUrl,
};

const dynamoClient = new DynamoDBClient(
  config.dynamodbEndpoint ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" } : {}
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const grantStore = createDynamoGrantStore({
  tableName: config.dynamodbTableGrants,
  client: docClient,
});

const useMockAuth =
  process.env.CELL_STAGE === "test" && typeof process.env.MOCK_JWT_SECRET === "string";
const jwtVerifier = useMockAuth
  ? createMockJwtVerifier(process.env.MOCK_JWT_SECRET!)
  : createCognitoJwtVerifier(cognitoConfig);

const oauthServer = createOAuthServer({
  issuerUrl: config.baseUrl,
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: ["use_mcp", "manage_delegates"],
});

const app = createApp({ config, oauthServer });

const honoHandler = handle(app);

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
