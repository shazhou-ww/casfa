import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito";
import {
  createDynamoGrantStore,
  createOAuthServer,
  getTokenFromRequest,
} from "@casfa/cell-oauth";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createDelegatesRoutes } from "./controllers/delegates";
import { createMcpRoutes } from "./controllers/mcp";
import { createOAuthRoutes } from "./controllers/oauth";

const cognitoConfig: CognitoConfig = {
  region: process.env.COGNITO_REGION ?? "us-east-1",
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
};

const cookieConfig = {
  cookieName: "casfa_token",
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
  cookiePath: "/",
};

const dynamoClient = new DynamoDBClient(
  process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: "us-east-1" }
    : {}
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const grantStore = createDynamoGrantStore({
  tableName: process.env.DYNAMODB_TABLE_GRANTS ?? "image-workshop-grants",
  client: docClient,
});

const useMockAuth =
  process.env.CELL_STAGE === "test" && typeof process.env.E2E_MOCK_JWT_SECRET === "string";
const jwtVerifier = useMockAuth
  ? createMockJwtVerifier(process.env.E2E_MOCK_JWT_SECRET!)
  : createCognitoJwtVerifier(cognitoConfig);
console.log("[boot] jwt verifier:", useMockAuth ? "MOCK" : "COGNITO");

const oauthServer = createOAuthServer({
  issuerUrl: process.env.CELL_BASE_URL ?? "",
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: ["use_mcp", "manage_delegates"],
});

const app = new Hono();

const oauthRoutes = createOAuthRoutes({ oauthServer, cookieConfig });
app.route("/", oauthRoutes);

app.use("*", async (c, next) => {
  const token = getTokenFromRequest(c.req.raw, {
    cookieName: cookieConfig.cookieName,
  });
  if (!token) {
    await next();
    return;
  }
  const auth = await oauthServer.resolveAuth(token);
  c.set("auth", auth);
  await next();
});

const delegateRoutes = createDelegatesRoutes({ oauthServer });
app.route("/", delegateRoutes);

const mcpRoutes = createMcpRoutes();
app.route("/", mcpRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[api] 500", c.req.method, c.req.path, err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  return c.json({ error: "INTERNAL_ERROR", message: err.message ?? "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "NOT_FOUND", message: "Not found" }, 404));

export type App = typeof app;
export { app };
