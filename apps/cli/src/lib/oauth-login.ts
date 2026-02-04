/**
 * OAuth 2.0 Authorization Code Flow with PKCE for CLI login.
 *
 * This module implements the OAuth login flow:
 * 1. Generate PKCE code_verifier and code_challenge
 * 2. Start local HTTP server to receive callback
 * 3. Open browser to Cognito authorization URL
 * 4. Wait for user to complete login
 * 5. Exchange authorization code for tokens
 * 6. Save credentials
 */

import type { CasfaAnonymousClient } from "@casfa/client";
import chalk from "chalk";
import open from "open";
import ora from "ora";
import { setCredentials } from "./credentials";
import { type CallbackError, findAvailablePort, waitForCallback } from "./local-server";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce";

export interface OAuthLoginOptions {
  client: CasfaAnonymousClient;
  profileName: string;
  /** Optional timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Optional preferred port for local server */
  preferredPort?: number;
}

export interface OAuthLoginResult {
  success: boolean;
  userId?: string;
}

/**
 * Perform OAuth 2.0 Authorization Code Flow with PKCE.
 */
export async function oauthLogin(options: OAuthLoginOptions): Promise<OAuthLoginResult> {
  const { client, profileName, timeoutMs = 300000, preferredPort = 9876 } = options;

  // Step 1: Get OAuth configuration
  const configSpinner = ora("Fetching OAuth configuration...").start();

  const configResult = await client.oauth.getConfig();
  if (!configResult.ok) {
    configSpinner.fail("Failed to get OAuth configuration");
    throw new Error(configResult.error?.message || "Failed to get OAuth configuration");
  }

  const config = configResult.data;
  configSpinner.succeed("OAuth configuration loaded");

  // Step 2: Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Step 3: Find an available port and start local server
  const portSpinner = ora("Starting local server...").start();

  let port: number;
  try {
    port = await findAvailablePort(preferredPort);
    portSpinner.succeed(`Local server ready on port ${port}`);
  } catch (error) {
    portSpinner.fail("Failed to start local server");
    throw error;
  }

  const redirectUri = `http://localhost:${port}/callback`;

  // Step 4: Build authorization URL
  const authUrl = client.oauth.buildAuthUrl({
    config,
    redirectUri,
    codeChallenge,
    state,
  });

  // Step 5: Display instructions and open browser
  console.log();
  console.log(chalk.cyan("┌─────────────────────────────────────────────────────┐"));
  console.log(
    `${chalk.cyan("│")}  Opening browser for login...                       ${chalk.cyan("│")}`
  );
  console.log(
    `${chalk.cyan("│")}                                                     ${chalk.cyan("│")}`
  );
  console.log(
    `${chalk.cyan("│")}  If browser doesn't open, visit:                    ${chalk.cyan("│")}`
  );
  console.log(`${chalk.cyan("│")}  ${chalk.dim(authUrl.slice(0, 49))}${chalk.cyan("│")}`);
  console.log(chalk.cyan("└─────────────────────────────────────────────────────┘"));
  console.log();

  // Try to open browser
  try {
    await open(authUrl);
  } catch {
    console.log(chalk.yellow("Could not open browser automatically."));
    console.log(chalk.yellow("Please copy and paste the URL above into your browser."));
    console.log();
  }

  // Step 6: Wait for callback
  const waitSpinner = ora("Waiting for login... (press Ctrl+C to cancel)").start();

  let callbackResult: { code: string; state: string };
  try {
    callbackResult = await waitForCallback(port, state, timeoutMs);
    waitSpinner.succeed("Authorization received");
  } catch (error) {
    waitSpinner.fail("Authorization failed");

    // Check if it's a CallbackError
    if (error && typeof error === "object" && "error" in error) {
      const callbackError = error as CallbackError;
      const message = callbackError.errorDescription || callbackError.error;
      throw new Error(`Authorization denied: ${message}`);
    }

    throw error;
  }

  // Step 7: Exchange authorization code for tokens
  const tokenSpinner = ora("Exchanging authorization code...").start();

  const tokenResult = await client.oauth.exchangeCode({
    code: callbackResult.code,
    redirectUri,
    codeVerifier,
  });

  if (!tokenResult.ok) {
    tokenSpinner.fail("Failed to exchange authorization code");
    throw new Error(tokenResult.error?.message || "Token exchange failed");
  }

  const tokens = tokenResult.data;
  tokenSpinner.succeed("Tokens received");

  // Step 8: Save credentials
  // Use id_token instead of access_token because id_token contains user claims (email, etc.)
  setCredentials(profileName, {
    type: "oauth",
    accessToken: tokens.id_token,
    refreshToken: tokens.refresh_token || "",
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
  });

  console.log();
  console.log(`${chalk.green("✓")} Login successful!`);

  return { success: true };
}
