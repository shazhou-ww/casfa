import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito";
import { createDynamoGrantStore, createOAuthServer } from "@casfa/cell-oauth";
import { Hono } from "hono";
import { createDelegatesRoutes } from "./controllers/delegates";
import { createMcpRoutes } from "./controllers/mcp";
import { createOAuthRoutes } from "./controllers/oauth";

const cognitoConfig: CognitoConfig = {
  region: process.env.COGNITO_REGION ?? "us-east-1",
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
};

const dynamoClient = new DynamoDBClient(
  process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: "us-east-1" }
    : {},
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const grantStore = createDynamoGrantStore({
  tableName: process.env.DYNAMODB_TABLE_GRANTS ?? "image-workshop-grants",
  client: docClient,
});

const jwtVerifier = process.env.E2E_MOCK_JWT_SECRET
  ? createMockJwtVerifier(process.env.E2E_MOCK_JWT_SECRET)
  : createCognitoJwtVerifier(cognitoConfig);

const oauthServer = createOAuthServer({
  issuerUrl: process.env.APP_ORIGIN ?? "",
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: ["use_mcp", "manage_delegates"],
});

const app = new Hono();

const oauthRoutes = createOAuthRoutes({ oauthServer });
app.route("/", oauthRoutes);

app.use("*", async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  c.set("auth", token ? await oauthServer.resolveAuth(token) : null);
  await next();
});

const delegateRoutes = createDelegatesRoutes({ oauthServer });
app.route("/", delegateRoutes);

const mcpRoutes = createMcpRoutes();
app.route("/", mcpRoutes);

export type App = typeof app;
export { app };
