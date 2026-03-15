import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
  createOAuthServer,
} from "@casfa/cell-cognito-server";
import { createDynamoGrantStore, createDynamoPendingClientInfoStore } from "@casfa/cell-delegates-server";
import { createApp } from "./app.ts";
import { isMockAuthEnabled, loadConfig } from "./config.ts";
import { createDynamoServerRegistry } from "./services/dynamo-server-registry.ts";
import { createDynamoServerOAuthStateStore } from "./services/dynamo-server-oauth-state.ts";

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
  permissions: ["use_mcp"],
});

const app = createApp({
  config,
  oauthServer,
  grantStore,
  pendingClientInfoStore,
  serverRegistry: createDynamoServerRegistry({
    tableName: config.dynamodbTableServers,
    clientConfig: config.dynamodbEndpoint
      ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
      : undefined,
  }),
  oauthStateStore: createDynamoServerOAuthStateStore({
    tableName: config.dynamodbTableServerOAuthStates,
    clientConfig: config.dynamodbEndpoint
      ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
      : undefined,
  }),
});

export { app };
