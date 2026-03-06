import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CognitoConfig,
  createCognitoJwtVerifier,
  createMockJwtVerifier,
} from "@casfa/cell-cognito-server";
import { getTokenFromRequest } from "@casfa/cell-auth-server";
import { type Auth, createOAuthServer } from "@casfa/cell-cognito-server";
import {
  createDynamoGrantStore,
  createDynamoPendingClientInfoStore,
  createDelegatesRoutes,
} from "@casfa/cell-delegates-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { loadConfig, isMockAuthEnabled } from "./config.ts";
import { createLoginRedirectRoutes } from "./controllers/login-redirect.ts";
import { createMcpRoutes } from "./controllers/mcp.ts";
import type { Env } from "./types.ts";

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
console.log("[boot] jwt verifier:", isMockAuthEnabled(config) ? "MOCK" : "COGNITO");

const oauthServer = createOAuthServer({
  issuerUrl: config.baseUrl,
  cognitoConfig,
  jwtVerifier,
  grantStore,
  permissions: ["use_mcp", "manage_delegates"],
});

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  const cookieName = config.auth.cookieName ?? undefined;
  const token = getTokenFromRequest(c.req.raw, {
    cookieName: cookieName ?? undefined,
    cookieOnly: false,
  });
  if (!token) {
    await next();
    return;
  }
  const auth = await oauthServer.resolveAuth(token);
  if (auth) {
    c.set("auth", auth);
  }
  await next();
});

const oauthRoutes = createLoginRedirectRoutes(config, { pendingClientInfoStore });
app.route("/", oauthRoutes);

const delegateRoutes = createDelegatesRoutes({
  grantStore,
  getUserId: (auth) => (auth?.type === "user" ? auth.userId : ""),
});
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
