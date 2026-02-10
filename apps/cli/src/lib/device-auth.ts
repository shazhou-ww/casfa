import type { CasfaClient } from "@casfa/client";
import chalk from "chalk";
import open from "open";
import ora from "ora";
import { type Credentials, setCredentials } from "./credentials";

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceAuthOptions {
  client: CasfaClient;
  profileName: string;
  onUserCode?: (response: DeviceCodeResponse) => void;
}

/**
 * Perform OAuth 2.0 Device Authorization Grant flow
 */
export async function deviceCodeLogin(options: DeviceAuthOptions): Promise<boolean> {
  const { client, profileName, onUserCode } = options;

  // Step 1: Request device code
  const spinner = ora("Requesting device code...").start();

  let deviceResponse: DeviceCodeResponse;
  try {
    deviceResponse = await requestDeviceCode(client);
    spinner.stop();
  } catch (error) {
    spinner.fail("Failed to request device code");
    throw error;
  }

  // Step 2: Display user code and open browser
  console.log();
  console.log(chalk.cyan("┌─────────────────────────────────────────────────────┐"));
  console.log(
    `${chalk.cyan("│")}  Open this URL in your browser:                     ${chalk.cyan("│")}`
  );
  console.log(
    chalk.cyan("│") +
      `  ${chalk.bold.underline(deviceResponse.verificationUri).padEnd(51)}` +
      chalk.cyan("│")
  );
  console.log(
    `${chalk.cyan("│")}                                                     ${chalk.cyan("│")}`
  );
  console.log(
    chalk.cyan("│") +
      `  Enter code: ${chalk.bold.yellow(deviceResponse.userCode)}                              `.slice(
        0,
        53
      ) +
      chalk.cyan("│")
  );
  console.log(chalk.cyan("└─────────────────────────────────────────────────────┘"));
  console.log();

  if (onUserCode) {
    onUserCode(deviceResponse);
  }

  // Try to open browser
  try {
    const urlToOpen = deviceResponse.verificationUriComplete || deviceResponse.verificationUri;
    await open(urlToOpen);
  } catch {
    // Ignore if can't open browser
  }

  // Step 3: Poll for token
  const pollSpinner = ora("Waiting for authorization... (press Ctrl+C to cancel)").start();

  try {
    const tokenResponse = await pollForToken(client, deviceResponse);

    // Save credentials
    const cred: Credentials = {
      version: 3,
      userToken: {
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + tokenResponse.expiresIn,
      },
    };
    setCredentials(profileName, cred);

    pollSpinner.succeed("Login successful!");
    return true;
  } catch (error) {
    pollSpinner.fail("Authorization failed");
    throw error;
  }
}

async function requestDeviceCode(client: CasfaClient): Promise<DeviceCodeResponse> {
  // This would call the OAuth device authorization endpoint
  // For now, we'll simulate with the Cognito config
  const _cognitoConfig = await client.oauth.getConfig();

  // In a real implementation, this would call:
  // POST /oauth/device_authorization
  // client_id=xxx
  // scope=openid email profile

  // Simulated response structure
  // The actual implementation depends on the auth server supporting device flow
  throw new Error(
    "Device code flow not yet implemented on server. " +
      "Please use 'casfa auth token create' with a pre-existing token, " +
      "or set CASFA_TOKEN environment variable."
  );
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function pollForToken(
  client: CasfaClient,
  deviceResponse: DeviceCodeResponse
): Promise<TokenResponse> {
  const interval = (deviceResponse.interval || 5) * 1000;
  const expiresAt = Date.now() + deviceResponse.expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await sleep(interval);

    try {
      // Poll token endpoint
      // POST /oauth/token
      // grant_type=urn:ietf:params:oauth:grant-type:device_code
      // device_code=xxx
      // client_id=xxx

      // Simulated - actual implementation depends on server
      throw new Error("authorization_pending");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (message === "authorization_pending") {
        // User hasn't authorized yet, continue polling
        continue;
      }
      if (message === "slow_down") {
        // Slow down polling
        await sleep(5000);
        continue;
      }
      if (message === "expired_token") {
        throw new Error("Device code expired. Please try again.");
      }
      if (message === "access_denied") {
        throw new Error("Authorization was denied.");
      }
      throw error;
    }
  }

  throw new Error("Device code expired. Please try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
