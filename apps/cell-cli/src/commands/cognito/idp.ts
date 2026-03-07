import {
  CreateIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  UpdateIdentityProviderCommand,
  IdentityProviderTypeType,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  createCognitoClient,
  maskSecret,
  promptYesNo,
  requirePoolId,
  resolveCognitoEnv,
} from "./shared.js";

type ProviderName = "google" | "microsoft";

type IdpConfig = {
  providerName: string;
  providerType: (typeof IdentityProviderTypeType)[keyof typeof IdentityProviderTypeType];
  details: Record<string, string>;
  attributeMapping: Record<string, string>;
};

function buildIdpConfig(
  provider: ProviderName,
  clientId: string,
  clientSecret: string,
  tenant: string
): IdpConfig {
  if (provider === "google") {
    return {
      providerName: "Google",
      providerType: IdentityProviderTypeType.Google,
      details: {
        client_id: clientId,
        client_secret: clientSecret,
        authorize_scopes: "openid email profile",
      },
      attributeMapping: {
        email: "email",
        username: "sub",
      },
    };
  }

  return {
    providerName: "Microsoft",
    providerType: IdentityProviderTypeType.OIDC,
    details: {
      client_id: clientId,
      client_secret: clientSecret,
      authorize_scopes: "openid email profile",
      oidc_issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      attributes_request_method: "GET",
    },
    attributeMapping: {
      email: "email",
      username: "sub",
    },
  };
}

export type IdpSetupOptions = {
  provider: string;
  poolId?: string;
  region?: string;
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
  yes?: boolean;
};

export async function idpSetupCommand(opts: IdpSetupOptions): Promise<void> {
  const provider = opts.provider.toLowerCase();
  if (provider !== "google" && provider !== "microsoft") {
    throw new Error('Provider must be "google" or "microsoft"');
  }

  const env = resolveCognitoEnv({ poolId: opts.poolId, region: opts.region });
  const poolId = requirePoolId(env);
  const client = createCognitoClient(env.region);

  const idpClientId = resolveIdpCredential(
    opts.clientId,
    provider === "google" ? env.googleClientId : env.microsoftClientId,
    `${provider.toUpperCase()}_CLIENT_ID`
  );
  const idpClientSecret = resolveIdpCredential(
    opts.clientSecret,
    provider === "google" ? env.googleClientSecret : env.microsoftClientSecret,
    `${provider.toUpperCase()}_CLIENT_SECRET`
  );

  const tenant = opts.tenant ?? "common";
  const config = buildIdpConfig(provider, idpClientId, idpClientSecret, tenant);

  let exists = false;
  try {
    const describeResult = await client.send(
      new DescribeIdentityProviderCommand({
        UserPoolId: poolId,
        ProviderName: config.providerName,
      })
    );
    exists = !!describeResult.IdentityProvider;

    if (exists) {
      const currentDetails = describeResult.IdentityProvider?.ProviderDetails ?? {};
      const clientIdMatch = currentDetails.client_id === idpClientId;
      const secretMatch = currentDetails.client_secret === idpClientSecret;

      if (clientIdMatch && secretMatch) {
        console.log(`${config.providerName} IdP is already in sync.`);
        return;
      }

      console.log(`\n${config.providerName} IdP exists, credentials need updating:`);
      if (!clientIdMatch) {
        console.log(
          `  client_id: ${maskSecret(currentDetails.client_id ?? "")} -> ${maskSecret(idpClientId)}`
        );
      }
      if (!secretMatch) {
        console.log(
          `  client_secret: ${maskSecret(currentDetails.client_secret ?? "")} -> ${maskSecret(idpClientSecret)}`
        );
      }
    }
  } catch (err) {
    if ((err as Error).name !== "ResourceNotFoundException") {
      throw err;
    }
  }

  if (!opts.yes) {
    const action = exists ? "Update" : "Create";
    const confirmed = await promptYesNo(`${action} ${config.providerName} IdP?`);
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  if (exists) {
    await client.send(
      new UpdateIdentityProviderCommand({
        UserPoolId: poolId,
        ProviderName: config.providerName,
        ProviderDetails: config.details,
        AttributeMapping: config.attributeMapping,
      })
    );
    console.log(`${config.providerName} IdP updated successfully.`);
  } else {
    await client.send(
      new CreateIdentityProviderCommand({
        UserPoolId: poolId,
        ProviderName: config.providerName,
        ProviderType: config.providerType,
        ProviderDetails: config.details,
        AttributeMapping: config.attributeMapping,
      })
    );
    console.log(`${config.providerName} IdP created successfully.`);
  }
}

export type IdpSyncOptions = {
  poolId?: string;
  region?: string;
  yes?: boolean;
};

export async function idpSyncCommand(opts: IdpSyncOptions): Promise<void> {
  const env = resolveCognitoEnv({ poolId: opts.poolId, region: opts.region });
  requirePoolId(env);

  console.log("\nSyncing identity providers from environment...");

  let synced = 0;

  if (env.googleClientId && env.googleClientSecret) {
    console.log("\n--- Google ---");
    await idpSetupCommand({
      provider: "google",
      poolId: opts.poolId,
      region: opts.region,
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      yes: opts.yes,
    });
    synced++;
  } else {
    console.log("Skipping Google — GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");
  }

  if (env.microsoftClientId && env.microsoftClientSecret) {
    console.log("\n--- Microsoft ---");
    await idpSetupCommand({
      provider: "microsoft",
      poolId: opts.poolId,
      region: opts.region,
      clientId: env.microsoftClientId,
      clientSecret: env.microsoftClientSecret,
      yes: opts.yes,
    });
    synced++;
  } else {
    console.log("Skipping Microsoft — MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not set");
  }

  if (synced === 0) {
    console.log("\nNo IdP credentials found in environment. Nothing to sync.");
  } else {
    console.log(`\nSync complete (${synced} provider(s) processed).`);
  }
}

function resolveIdpCredential(
  cliValue: string | undefined,
  envValue: string,
  envName: string
): string {
  const value = cliValue ?? envValue;
  if (!value) {
    throw new Error(`${envName} is required. Pass via CLI flag or set in .env`);
  }
  return value;
}
