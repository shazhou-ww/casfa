/**
 * Gateway entry: build SSO Hono app from env (e.g. resolvedConfig.envVars).
 * Used when mounting this cell under a path prefix in the platform gateway.
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
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { loadConfigFromEnv } from "./config.ts";
import { createDynamoRefreshSessionStore } from "./refresh-session-store.ts";

export function createAppForGateway(env: Record<string, string>): Hono {
  const config = loadConfigFromEnv(env);

  const cognitoConfig: CognitoConfig = {
    region: config.cognito.region,
    userPoolId: config.cognito.userPoolId,
    clientId: config.cognito.clientId,
    clientSecret: config.cognito.clientSecret,
    hostedUiUrl: config.cognito.hostedUiUrl,
  };

  const dynamoClient = new DynamoDBClient(
    config.dynamodbEndpoint
      ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
      : {}
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
    env.CELL_STAGE === "test" && typeof env.MOCK_JWT_SECRET === "string";
  const jwtVerifier = useMockAuth
    ? createMockJwtVerifier(env.MOCK_JWT_SECRET!)
    : createCognitoJwtVerifier(cognitoConfig);

  const oauthServer = createOAuthServer({
    issuerUrl: config.baseUrl,
    cognitoConfig,
    jwtVerifier,
    grantStore,
    permissions: ["use_mcp", "manage_delegates"],
  });

  return createApp({ config, oauthServer, refreshSessionStore });
}
