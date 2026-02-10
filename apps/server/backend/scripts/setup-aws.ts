#!/usr/bin/env bun
/**
 * CASFA v2 - AWS Environment Setup
 *
 * One-time setup script to configure AWS resources for development:
 *   1. Create DynamoDB tables on AWS (if missing)
 *   2. Sync Cognito Identity Provider secrets from .env
 *   3. Update Cognito App Client callback URLs
 *
 * Prerequisites:
 *   - AWS CLI credentials configured (~/.aws/credentials or environment vars)
 *   - .env file at monorepo root with Cognito & IdP configuration
 *
 * Usage:
 *   bun run setup:aws                     # Interactive mode
 *   bun run setup:aws -y                  # Auto-yes to all prompts
 *   bun run setup:aws --skip-tables       # Skip DynamoDB table creation
 *   bun run setup:aws --skip-cognito      # Skip Cognito IdP configuration
 *   bun run setup:aws --skip-callbacks    # Skip callback URL update
 *
 * Environment variables (loaded from root .env):
 *   COGNITO_USER_POOL_ID       - Cognito User Pool ID
 *   CASFA_COGNITO_CLIENT_ID    - Cognito App Client ID
 *   COGNITO_REGION             - AWS region (default: us-east-1)
 *   GOOGLE_CLIENT_ID           - Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET       - Google OAuth client secret
 *   MICROSOFT_CLIENT_ID        - Microsoft OAuth client ID
 *   MICROSOFT_CLIENT_SECRET    - Microsoft OAuth client secret
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";

// Load .env from monorepo root
const monorepoRoot = resolve(import.meta.dir, "../../../../");
const envPath = resolve(monorepoRoot, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import {
  CognitoIdentityProviderClient,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  UpdateIdentityProviderCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createAllTables, createClient, listTables } from "./create-local-tables.ts";

// ============================================================================
// Configuration
// ============================================================================

const region = process.env.COGNITO_REGION ?? "us-east-1";
const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
const clientId = process.env.CASFA_COGNITO_CLIENT_ID ?? "";

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID ?? "";
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET ?? "";

// Default callback URLs for the Cognito App Client
const DEFAULT_CALLBACK_URLS = [
  "http://localhost:8901/oauth/callback", // Frontend dev server
  "http://localhost:8801/oauth/callback", // Backend direct
  "http://localhost:3000/oauth/callback", // Alternative dev port
];

const DEFAULT_LOGOUT_URLS = [
  "http://localhost:8901/login",
  "http://localhost:8801/login",
  "http://localhost:3000/login",
];

// ============================================================================
// Helpers
// ============================================================================

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

// ============================================================================
// Step 1: DynamoDB Tables
// ============================================================================

async function setupDynamoDBTables(autoYes: boolean): Promise<void> {
  console.log("\n📦 Step 1: AWS DynamoDB Tables");
  console.log("─".repeat(50));

  try {
    const awsClient = createClient(); // no endpoint = use AWS default
    const existingTables = await listTables(awsClient);
    const requiredTables = ["cas-tokens", "cas-realm", "cas-refcount", "cas-usage"];
    const missingTables = requiredTables.filter((t) => !existingTables.includes(t));

    if (missingTables.length === 0) {
      console.log("✅ All required DynamoDB tables exist:");
      for (const t of requiredTables) console.log(`   • ${t}`);
      return;
    }

    console.log(`Found ${existingTables.length} existing tables.`);
    console.log(`Missing tables: ${missingTables.join(", ")}`);

    const shouldCreate = autoYes || (await promptYesNo("Create missing DynamoDB tables on AWS?"));

    if (!shouldCreate) {
      console.log("⏭️  Skipped DynamoDB table creation.");
      return;
    }

    console.log("\nCreating tables (PAY_PER_REQUEST billing)...");
    await createAllTables(awsClient);
    console.log("✅ DynamoDB tables created successfully!");
  } catch (err) {
    console.error(`❌ DynamoDB setup failed: ${(err as Error).message}`);
    console.error("   Check your AWS credentials and permissions.");
  }
}

// ============================================================================
// Step 2: Cognito Identity Provider Secrets
// ============================================================================

async function setupCognitoIdPSecrets(autoYes: boolean): Promise<void> {
  console.log("\n🔐 Step 2: Cognito Identity Provider Secrets");
  console.log("─".repeat(50));

  if (!userPoolId) {
    console.log("⏭️  Skipped — COGNITO_USER_POOL_ID not set in .env");
    return;
  }

  const cognitoClient = new CognitoIdentityProviderClient({ region });
  const updates: Array<{ name: string; envClientId: string; envSecret: string }> = [];

  // Check Google
  if (googleClientId && googleClientSecret) {
    updates.push({
      name: "Google",
      envClientId: googleClientId,
      envSecret: googleClientSecret,
    });
  } else {
    console.log("⏭️  Google — GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set, skipping");
  }

  // Check Microsoft
  if (microsoftClientId && microsoftClientSecret) {
    updates.push({
      name: "Microsoft",
      envClientId: microsoftClientId,
      envSecret: microsoftClientSecret,
    });
  } else {
    console.log("⏭️  Microsoft — MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not set, skipping");
  }

  for (const { name, envClientId, envSecret } of updates) {
    try {
      // Get current IdP config from Cognito
      const describeResult = await cognitoClient.send(
        new DescribeIdentityProviderCommand({
          UserPoolId: userPoolId,
          ProviderName: name,
        })
      );

      const currentDetails = describeResult.IdentityProvider?.ProviderDetails ?? {};
      const currentClientId = currentDetails.client_id ?? "";
      const currentSecret = currentDetails.client_secret ?? "";

      // For OIDC providers (Microsoft), the field is client_secret
      // For social providers (Google), it's also client_secret
      const clientIdMatch = currentClientId === envClientId;
      const secretMatch = currentSecret === envSecret;

      if (clientIdMatch && secretMatch) {
        console.log(`✅ ${name} — secrets are in sync`);
        continue;
      }

      console.log(`\n🔄 ${name} — secrets need updating:`);
      if (!clientIdMatch) {
        console.log(`   client_id: ${maskSecret(currentClientId)} → ${maskSecret(envClientId)}`);
      }
      if (!secretMatch) {
        console.log(`   client_secret: ${maskSecret(currentSecret)} → ${maskSecret(envSecret)}`);
      }

      const shouldUpdate = autoYes || (await promptYesNo(`Update ${name} IdP secrets in Cognito?`));

      if (!shouldUpdate) {
        console.log(`⏭️  Skipped ${name} update.`);
        continue;
      }

      // Update the provider
      const updatedDetails = { ...currentDetails };
      updatedDetails.client_id = envClientId;
      updatedDetails.client_secret = envSecret;

      await cognitoClient.send(
        new UpdateIdentityProviderCommand({
          UserPoolId: userPoolId,
          ProviderName: name,
          ProviderDetails: updatedDetails,
        })
      );

      console.log(`✅ ${name} — secrets updated in Cognito`);
    } catch (err) {
      const errName = (err as Error).name;
      if (errName === "ResourceNotFoundException") {
        console.log(`⚠️  ${name} — IdP not configured in User Pool, skipping`);
      } else {
        console.error(`❌ ${name} — failed: ${(err as Error).message}`);
      }
    }
  }
}

// ============================================================================
// Step 3: Cognito Callback URLs
// ============================================================================

async function setupCallbackUrls(autoYes: boolean): Promise<void> {
  console.log("\n🔗 Step 3: Cognito App Client Callback URLs");
  console.log("─".repeat(50));

  if (!userPoolId || !clientId) {
    console.log("⏭️  Skipped — COGNITO_USER_POOL_ID or CASFA_COGNITO_CLIENT_ID not set");
    return;
  }

  const cognitoClient = new CognitoIdentityProviderClient({ region });

  try {
    const describeResult = await cognitoClient.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
      })
    );

    const clientConfig = describeResult.UserPoolClient;
    if (!clientConfig) {
      console.error("❌ Could not retrieve App Client configuration");
      return;
    }

    const currentCallbacks = clientConfig.CallbackURLs ?? [];
    const currentLogouts = clientConfig.LogoutURLs ?? [];

    // Find missing callback URLs
    const missingCallbacks = DEFAULT_CALLBACK_URLS.filter((u) => !currentCallbacks.includes(u));
    const missingLogouts = DEFAULT_LOGOUT_URLS.filter((u) => !currentLogouts.includes(u));

    if (missingCallbacks.length === 0 && missingLogouts.length === 0) {
      console.log("✅ All dev callback/logout URLs are configured:");
      for (const url of currentCallbacks) console.log(`   callback: ${url}`);
      for (const url of currentLogouts) console.log(`   logout:   ${url}`);
      return;
    }

    if (missingCallbacks.length > 0) {
      console.log("Missing callback URLs:");
      for (const url of missingCallbacks) console.log(`   + ${url}`);
    }
    if (missingLogouts.length > 0) {
      console.log("Missing logout URLs:");
      for (const url of missingLogouts) console.log(`   + ${url}`);
    }

    const shouldUpdate = autoYes || (await promptYesNo("Add missing URLs to Cognito App Client?"));

    if (!shouldUpdate) {
      console.log("⏭️  Skipped callback URL update.");
      return;
    }

    const newCallbacks = [...new Set([...currentCallbacks, ...DEFAULT_CALLBACK_URLS])];
    const newLogouts = [...new Set([...currentLogouts, ...DEFAULT_LOGOUT_URLS])];

    await cognitoClient.send(
      new UpdateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        // Must re-specify these fields when updating
        CallbackURLs: newCallbacks,
        LogoutURLs: newLogouts,
        AllowedOAuthFlows: clientConfig.AllowedOAuthFlows,
        AllowedOAuthScopes: clientConfig.AllowedOAuthScopes,
        AllowedOAuthFlowsUserPoolClient: clientConfig.AllowedOAuthFlowsUserPoolClient,
        SupportedIdentityProviders: clientConfig.SupportedIdentityProviders,
        ExplicitAuthFlows: clientConfig.ExplicitAuthFlows,
      })
    );

    console.log("✅ Callback URLs updated successfully!");
  } catch (err) {
    console.error(`❌ Callback URL setup failed: ${(err as Error).message}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const autoYes = args.includes("-y") || args.includes("--yes");
  const skipTables = args.includes("--skip-tables");
  const skipCognito = args.includes("--skip-cognito");
  const skipCallbacks = args.includes("--skip-callbacks");

  console.log("=".repeat(60));
  console.log("CASFA v2 - AWS Environment Setup");
  console.log("=".repeat(60));
  console.log();
  console.log("Configuration (from .env):");
  console.log(`  Region:          ${region}`);
  console.log(`  User Pool ID:    ${userPoolId || "(not set)"}`);
  console.log(`  App Client ID:   ${clientId || "(not set)"}`);
  console.log(`  Google:          ${googleClientId ? "configured" : "not set"}`);
  console.log(`  Microsoft:       ${microsoftClientId ? "configured" : "not set"}`);

  // Step 1: DynamoDB
  if (!skipTables) {
    await setupDynamoDBTables(autoYes);
  } else {
    console.log("\n⏭️  Step 1: DynamoDB — skipped (--skip-tables)");
  }

  // Step 2: Cognito IdP Secrets
  if (!skipCognito) {
    await setupCognitoIdPSecrets(autoYes);
  } else {
    console.log("\n⏭️  Step 2: Cognito IdP — skipped (--skip-cognito)");
  }

  // Step 3: Callback URLs
  if (!skipCallbacks) {
    await setupCallbackUrls(autoYes);
  } else {
    console.log("\n⏭️  Step 3: Callback URLs — skipped (--skip-callbacks)");
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ AWS setup complete!");
  console.log("=".repeat(60));
  console.log("\nNext steps:");
  console.log("  bun run dev        # Start fullstack dev server (Cognito + AWS)");
  console.log("  bun run set-admin:aws <user-id>  # Set yourself as admin after first login");
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err);
  process.exit(1);
});
