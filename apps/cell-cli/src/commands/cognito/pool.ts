import {
  CreateUserPoolCommand,
  CreateUserPoolDomainCommand,
  DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  createCognitoClient,
  promptYesNo,
  requirePoolId,
  resolveCognitoEnv,
} from "./shared.js";

export type PoolCreateOptions = {
  name: string;
  region?: string;
  domain?: string;
  yes?: boolean;
};

export async function poolCreateCommand(opts: PoolCreateOptions): Promise<void> {
  const env = resolveCognitoEnv({ region: opts.region });
  const client = createCognitoClient(env.region);

  console.log(`\nCreating User Pool "${opts.name}" in ${env.region}...`);

  if (!opts.yes) {
    const confirmed = await promptYesNo("Proceed?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  const result = await client.send(
    new CreateUserPoolCommand({
      PoolName: opts.name,
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: false,
        },
      },
      Schema: [
        {
          Name: "email",
          Required: true,
          Mutable: true,
          AttributeDataType: "String",
        },
      ],
      MfaConfiguration: "OFF",
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
      },
    })
  );

  const poolId = result.UserPool?.Id ?? "";
  console.log(`\nUser Pool created successfully.`);
  console.log(`  Pool ID: ${poolId}`);

  if (opts.domain && poolId) {
    console.log(`\nCreating Hosted UI domain "${opts.domain}"...`);
    await client.send(
      new CreateUserPoolDomainCommand({
        Domain: opts.domain,
        UserPoolId: poolId,
      })
    );
    const hostedUiUrl = `https://${opts.domain}.auth.${env.region}.amazoncognito.com`;
    console.log(`  Hosted UI URL: ${hostedUiUrl}`);
  }

  console.log("\nAdd to your .env:");
  console.log(`  COGNITO_USER_POOL_ID=${poolId}`);
  console.log(`  COGNITO_REGION=${env.region}`);
  if (opts.domain) {
    console.log(
      `  COGNITO_HOSTED_UI_URL=https://${opts.domain}.auth.${env.region}.amazoncognito.com`
    );
  }
}

export type PoolDescribeOptions = {
  poolId?: string;
  region?: string;
};

export async function poolDescribeCommand(opts: PoolDescribeOptions): Promise<void> {
  const env = resolveCognitoEnv({ poolId: opts.poolId, region: opts.region });
  const poolId = requirePoolId(env);
  const client = createCognitoClient(env.region);

  const result = await client.send(
    new DescribeUserPoolCommand({ UserPoolId: poolId })
  );

  const pool = result.UserPool;
  if (!pool) {
    throw new Error(`User Pool ${poolId} not found`);
  }

  console.log(`\nUser Pool: ${pool.Name}`);
  console.log(`  ID:         ${pool.Id}`);
  console.log(`  Status:     ${pool.Status}`);
  console.log(`  Region:     ${env.region}`);
  if (pool.Domain) {
    console.log(`  Domain:     ${pool.Domain}`);
    console.log(`  Hosted UI:  https://${pool.Domain}.auth.${env.region}.amazoncognito.com`);
  }
  console.log(`  Created:    ${pool.CreationDate?.toISOString() ?? "unknown"}`);
  console.log(`  Modified:   ${pool.LastModifiedDate?.toISOString() ?? "unknown"}`);
}
