import { Hono } from "hono";
import { createDelegatesRoutes } from "./controllers/delegates";
import { createMcpRoutes } from "./controllers/mcp";
import { createOAuthRoutes } from "./controllers/oauth";
import { createGrantStore } from "./db/grant-store";
import { createAuthMiddleware } from "./middleware/auth";
import type { CognitoConfig } from "./utils/cognito";
import { createCognitoJwtVerifier, createMockJwtVerifier } from "./utils/jwt";

const cognitoConfig: CognitoConfig = {
  region: process.env.COGNITO_REGION ?? "us-east-1",
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
};

const grantStore = createGrantStore({
  tableName: process.env.DYNAMODB_TABLE_GRANTS ?? "image-workshop-grants",
  clientConfig: process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: "us-east-1" }
    : undefined,
});

const jwtVerifier = process.env.E2E_MOCK_JWT_SECRET
  ? createMockJwtVerifier(process.env.E2E_MOCK_JWT_SECRET)
  : createCognitoJwtVerifier(cognitoConfig);

const app = new Hono();

const oauthRoutes = createOAuthRoutes({ cognitoConfig, grantStore });
app.route("/", oauthRoutes);

const authMiddleware = createAuthMiddleware({ jwtVerifier, grantStore });
app.use("*", authMiddleware);

const delegateRoutes = createDelegatesRoutes({ grantStore });
app.route("/", delegateRoutes);

const mcpRoutes = createMcpRoutes();
app.route("/", mcpRoutes);

export type App = typeof app;
export { app };
