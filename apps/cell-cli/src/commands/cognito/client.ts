import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CreateUserPoolClientCommand,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { loadCellYaml } from "../../config/load-cell-yaml.js";
import {
  createCognitoClient,
  promptYesNo,
  requirePoolId,
  resolveCognitoEnv,
} from "./shared.js";

export type ClientCreateOptions = {
  name: string;
  poolId?: string;
  region?: string;
  callbackUrls?: string;
  logoutUrls?: string;
  providers?: string;
  generateSecret?: boolean;
  yes?: boolean;
};

export async function clientCreateCommand(opts: ClientCreateOptions): Promise<void> {
  const env = resolveCognitoEnv({ poolId: opts.poolId, region: opts.region });
  const poolId = requirePoolId(env);
  const client = createCognitoClient(env.region);

  const callbackUrls = opts.callbackUrls ? opts.callbackUrls.split(",").map((u) => u.trim()) : [];
  const logoutUrls = opts.logoutUrls ? opts.logoutUrls.split(",").map((u) => u.trim()) : [];
  const providers = opts.providers
    ? opts.providers.split(",").map((p) => p.trim())
    : ["Google", "Microsoft"];

  console.log(`\nCreating App Client "${opts.name}" on pool ${poolId}...`);
  console.log(`  Providers: ${providers.join(", ")}`);
  if (callbackUrls.length > 0) console.log(`  Callback URLs: ${callbackUrls.join(", ")}`);
  if (logoutUrls.length > 0) console.log(`  Logout URLs: ${logoutUrls.join(", ")}`);
  console.log(`  Generate secret: ${opts.generateSecret ? "yes" : "no"}`);

  if (!opts.yes) {
    const confirmed = await promptYesNo("Proceed?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  const result = await client.send(
    new CreateUserPoolClientCommand({
      UserPoolId: poolId,
      ClientName: opts.name,
      GenerateSecret: opts.generateSecret ?? false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "email", "profile"],
      AllowedOAuthFlowsUserPoolClient: true,
      SupportedIdentityProviders: providers,
      ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
      CallbackURLs: callbackUrls.length > 0 ? callbackUrls : undefined,
      LogoutURLs: logoutUrls.length > 0 ? logoutUrls : undefined,
    })
  );

  const newClientId = result.UserPoolClient?.ClientId ?? "";
  const newClientSecret = result.UserPoolClient?.ClientSecret;

  console.log(`\nApp Client created successfully.`);
  console.log(`  Client ID: ${newClientId}`);
  if (newClientSecret) {
    console.log(`  Client Secret: ${newClientSecret}`);
  }

  console.log("\nAdd to your .env:");
  console.log(`  COGNITO_CLIENT_ID=${newClientId}`);
}

export type ClientSyncUrlsOptions = {
  poolId?: string;
  clientId?: string;
  region?: string;
  addCallback?: string[];
  addLogout?: string[];
  yes?: boolean;
};

export async function clientSyncUrlsCommand(opts: ClientSyncUrlsOptions): Promise<void> {
  const env = resolveCognitoEnv({
    poolId: opts.poolId,
    clientId: opts.clientId,
    region: opts.region,
  });
  const poolId = requirePoolId(env);

  if (!env.clientId) {
    throw new Error(
      "Client ID is required. Pass --client-id or set COGNITO_CLIENT_ID in .env"
    );
  }

  const client = createCognitoClient(env.region);
  const callbacksToAdd = new Set<string>(opts.addCallback ?? []);
  const logoutsToAdd = new Set<string>(opts.addLogout ?? []);

  // Auto-derive URLs from cell.yaml if present
  const cellYamlPath = resolve(process.cwd(), "cell.yaml");
  if (existsSync(cellYamlPath)) {
    try {
      const config = loadCellYaml(cellYamlPath);
      if (config.domain && typeof config.domain.host === "string") {
        const host = config.domain.host;
        callbacksToAdd.add(`https://${host}/oauth/callback`);
        logoutsToAdd.add(`https://${host}`);
        console.log(`  Auto-derived from cell.yaml domain: ${host}`);
      }
    } catch {
      // cell.yaml parse error is non-fatal for this command
    }
  }

  if (callbacksToAdd.size === 0 && logoutsToAdd.size === 0) {
    console.log("No URLs to add. Pass --add-callback / --add-logout or run from a Cell directory.");
    return;
  }

  const describeResult = await client.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: poolId,
      ClientId: env.clientId,
    })
  );

  const clientConfig = describeResult.UserPoolClient;
  if (!clientConfig) {
    throw new Error("Could not retrieve App Client configuration");
  }

  const currentCallbacks = clientConfig.CallbackURLs ?? [];
  const currentLogouts = clientConfig.LogoutURLs ?? [];

  const newCallbacks = [...new Set([...currentCallbacks, ...callbacksToAdd])];
  const newLogouts = [...new Set([...currentLogouts, ...logoutsToAdd])];

  const addedCallbacks = newCallbacks.filter((u) => !currentCallbacks.includes(u));
  const addedLogouts = newLogouts.filter((u) => !currentLogouts.includes(u));

  if (addedCallbacks.length === 0 && addedLogouts.length === 0) {
    console.log("All URLs are already configured.");
    return;
  }

  console.log("\nURLs to add:");
  for (const u of addedCallbacks) console.log(`  + callback: ${u}`);
  for (const u of addedLogouts) console.log(`  + logout:   ${u}`);

  if (!opts.yes) {
    const confirmed = await promptYesNo("Update App Client URLs?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  await client.send(
    new UpdateUserPoolClientCommand({
      UserPoolId: poolId,
      ClientId: env.clientId,
      CallbackURLs: newCallbacks,
      LogoutURLs: newLogouts,
      AllowedOAuthFlows: clientConfig.AllowedOAuthFlows,
      AllowedOAuthScopes: clientConfig.AllowedOAuthScopes,
      AllowedOAuthFlowsUserPoolClient: clientConfig.AllowedOAuthFlowsUserPoolClient,
      SupportedIdentityProviders: clientConfig.SupportedIdentityProviders,
      ExplicitAuthFlows: clientConfig.ExplicitAuthFlows,
    })
  );

  console.log("Callback/logout URLs updated successfully.");
}
