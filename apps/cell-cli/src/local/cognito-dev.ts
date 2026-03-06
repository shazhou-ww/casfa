import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { fromSSO } from "@aws-sdk/credential-providers";
import type { CognitoConfig, ResolvedValue } from "../config/cell-yaml-schema.js";

function resolveString(v: ResolvedValue): string {
  return typeof v === "string" ? v : "";
}

export type EnsureCognitoDevCallbackUrlOptions = {
  /** Resolved param values from resolveConfig (cognito ids from .env via !Env/!Secret). */
  resolvedEnvVars?: Record<string, string>;
  /** AWS profile for SSO (e.g. from .env AWS_PROFILE; loadEnvFiles does not set process.env). */
  profile?: string;
};

/**
 * Ensure the local dev callback URL is registered in the Cognito App Client.
 * Adds it if missing, leaves existing URLs untouched.
 */
export async function ensureCognitoDevCallbackUrl(
  cognitoConfig: CognitoConfig,
  localCallbackUrl: string,
  options?: EnsureCognitoDevCallbackUrlOptions
): Promise<void> {
  const resolvedEnvVars = options?.resolvedEnvVars;
  const region = resolvedEnvVars?.COGNITO_REGION ?? resolveString(cognitoConfig.region);
  const userPoolId =
    resolvedEnvVars?.COGNITO_USER_POOL_ID ?? resolveString(cognitoConfig.userPoolId);
  const clientId = resolvedEnvVars?.COGNITO_CLIENT_ID ?? resolveString(cognitoConfig.clientId);

  if (!region || !userPoolId || !clientId) {
    console.warn("Cognito config incomplete, skipping callback URL check");
    return;
  }

  const profile = options?.profile ?? process.env.AWS_PROFILE ?? "default";
  const client = new CognitoIdentityProviderClient({
    region,
    credentials: fromSSO({ profile }),
  });

  let UserPoolClient;
  try {
    const res = await client.send(
      new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId })
    );
    UserPoolClient = res.UserPoolClient;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n✗ Cognito access failed: ${msg}`);
    console.error("  Run 'cell aws login' to refresh credentials (uses AWS_PROFILE from .env), then retry.\n");
    process.exit(1);
  }

  if (!UserPoolClient) {
    console.error("\n✗ Could not describe Cognito User Pool Client.\n");
    process.exit(1);
  }

  const existingCallbacks = UserPoolClient.CallbackURLs ?? [];
  if (existingCallbacks.includes(localCallbackUrl)) {
    return;
  }

  const updatedCallbacks = [...existingCallbacks, localCallbackUrl];
  const existingLogouts = UserPoolClient.LogoutURLs ?? [];
  const localOrigin = new URL(localCallbackUrl).origin;
  const updatedLogouts = existingLogouts.includes(localOrigin)
    ? existingLogouts
    : [...existingLogouts, localOrigin];

  await client.send(
    new UpdateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      CallbackURLs: updatedCallbacks,
      LogoutURLs: updatedLogouts,
      AllowedOAuthFlows: UserPoolClient.AllowedOAuthFlows,
      AllowedOAuthFlowsUserPoolClient: UserPoolClient.AllowedOAuthFlowsUserPoolClient,
      AllowedOAuthScopes: UserPoolClient.AllowedOAuthScopes,
      SupportedIdentityProviders: UserPoolClient.SupportedIdentityProviders,
      ExplicitAuthFlows: UserPoolClient.ExplicitAuthFlows,
      PreventUserExistenceErrors: UserPoolClient.PreventUserExistenceErrors,
      TokenValidityUnits: UserPoolClient.TokenValidityUnits,
      IdTokenValidity: UserPoolClient.IdTokenValidity,
      AccessTokenValidity: UserPoolClient.AccessTokenValidity,
      RefreshTokenValidity: UserPoolClient.RefreshTokenValidity,
    })
  );

  console.log(`Added ${localCallbackUrl} to Cognito callback URLs`);
}
