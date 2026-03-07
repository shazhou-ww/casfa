import { createInterface } from "node:readline";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { loadEnvFiles } from "../../utils/env.js";

export type CognitoEnv = {
  region: string;
  poolId: string;
  clientId: string;
  googleClientId: string;
  googleClientSecret: string;
  microsoftClientId: string;
  microsoftClientSecret: string;
};

/**
 * Resolve Cognito-related config from CLI flags and .env files.
 * CLI flags take precedence over environment variables.
 */
export function resolveCognitoEnv(opts: {
  poolId?: string;
  clientId?: string;
  region?: string;
}): CognitoEnv {
  const envMap = loadEnvFiles(process.cwd());

  if (envMap.AWS_PROFILE) {
    process.env.AWS_PROFILE = envMap.AWS_PROFILE;
  }

  return {
    region: opts.region ?? envMap.COGNITO_REGION ?? "us-east-1",
    poolId: opts.poolId ?? envMap.COGNITO_USER_POOL_ID ?? "",
    clientId: opts.clientId ?? envMap.COGNITO_CLIENT_ID ?? "",
    googleClientId: envMap.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: envMap.GOOGLE_CLIENT_SECRET ?? "",
    microsoftClientId: envMap.MICROSOFT_CLIENT_ID ?? "",
    microsoftClientSecret: envMap.MICROSOFT_CLIENT_SECRET ?? "",
  };
}

export function createCognitoClient(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
}

export function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function requirePoolId(env: CognitoEnv): string {
  if (!env.poolId) {
    throw new Error(
      "User Pool ID is required. Pass --pool-id or set COGNITO_USER_POOL_ID in .env"
    );
  }
  return env.poolId;
}
