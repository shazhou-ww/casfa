/**
 * Entry for cell dev: exports Hono app. Same bootstrap as lambda.ts minus Lambda handler.
 */
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito-server";
import { createOAuthServer } from "@casfa/cell-cognito-server";
import { createDynamoGrantStore } from "@casfa/cell-delegates-server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDynamoRefreshSessionStore } from "./refresh-session-store.ts";

const config = loadConfig();

const cognitoConfig: CognitoConfig = {
  region: config.cognito.region,
  userPoolId: config.cognito.userPoolId,
  clientId: config.cognito.clientId,
  clientSecret: config.cognito.clientSecret,
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
const refreshSessionStore = createDynamoRefreshSessionStore({
  tableName: config.dynamodbTableRefreshSessions,
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

const app = createApp({ config, oauthServer, refreshSessionStore });

export { app };
