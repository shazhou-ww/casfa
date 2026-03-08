#!/usr/bin/env bun
import { Command } from "commander";
import { buildCommand } from "./commands/build.js";
import { cleanCommand } from "./commands/clean.js";
import { deployCommand } from "./commands/deploy.js";
import { devCommand } from "./commands/dev.js";
import { initCommand } from "./commands/init.js";
import { lintCommand } from "./commands/lint.js";
import { awsLoginCommand, awsLogoutCommand } from "./commands/aws.js";
import { logsCommand } from "./commands/logs.js";
import { secretGetCommand, secretListCommand, secretSetCommand } from "./commands/secret.js";
import { statusCommand } from "./commands/status.js";
import { testCommand, testE2eCommand, testUnitCommand } from "./commands/test.js";
import { typecheckCommand } from "./commands/typecheck.js";
import { clientCreateCommand, clientSyncUrlsCommand } from "./commands/cognito/client.js";
import { idpSetupCommand, idpSyncCommand } from "./commands/cognito/idp.js";
import { poolCreateCommand, poolDescribeCommand } from "./commands/cognito/pool.js";
import { domainListCommand } from "./commands/domain.js";
import { MissingParamsError } from "./config/resolve-config.js";

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Error) {
      console.error(`\n  Error: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

const program = new Command();

program.name("cell").description("CLI for casfa Cell services").version("0.0.1");

program
  .command("dev")
  .description("Start local development environment")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await run(() => devCommand({ instance: opts.instance }));
  });

program
  .command("build")
  .description("Build frontend and backend artifacts")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await run(() => buildCommand({ instance: opts.instance }));
  });

program
  .command("clean")
  .description("Remove .cell and .esbuild directories")
  .action(() => {
    cleanCommand();
  });

program
  .command("deploy")
  .description("Deploy to cloud")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .option("--yes", "Skip confirmation")
  .option("--domain <alias>", "Target domain alias to deploy (required when domains configured; repeat for multiple). Run 'cell domain list' for aliases.", (v: string, prev: string[]) => [...(prev ?? []), v], [] as string[])
  .action(async (opts) => {
    await run(() => deployCommand({ yes: opts.yes, domains: opts.domain, instance: opts.instance }));
  });

program
  .command("test")
  .description("Run all tests (unit + e2e)")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await run(() => testCommand({ instance: opts.instance }));
  });

program
  .command("test:unit")
  .description("Run unit tests")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await testUnitCommand({ instance: opts.instance });
  });

program
  .command("test:e2e")
  .description("Run e2e tests")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await run(() => testE2eCommand({ instance: opts.instance }));
  });

program
  .command("lint")
  .description("Run linter")
  .option("--fix", "Auto-fix issues")
  .option("--unsafe", "Apply unsafe fixes (requires --fix)")
  .action(async (opts) => {
    await lintCommand({ fix: opts.fix, unsafe: opts.unsafe });
  });

program
  .command("typecheck")
  .description("Run TypeScript type checking")
  .action(async () => {
    await typecheckCommand();
  });

const aws = program.command("aws").description("AWS SSO login / logout (uses AWS_PROFILE from .env)");

aws
  .command("login")
  .description("Run aws sso login")
  .action(async () => {
    await awsLoginCommand();
  });

aws
  .command("logout")
  .description("Run aws sso logout")
  .action(async () => {
    await awsLogoutCommand();
  });

program
  .command("logs")
  .description("View CloudWatch logs")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .option("--follow", "Follow log output")
  .action(async (opts) => {
    await logsCommand({ follow: opts.follow, instance: opts.instance });
  });

program
  .command("status")
  .description("View CloudFormation stack status")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await statusCommand({ instance: opts.instance });
  });

const secret = program.command("secret").description("Manage secrets in Secrets Manager");

secret
  .command("set <key>")
  .description("Set a secret value")
  .action(async (key: string) => {
    await secretSetCommand(key);
  });

secret
  .command("get <key>")
  .description("Get a secret value")
  .action(async (key: string) => {
    await secretGetCommand(key);
  });

secret
  .command("list")
  .description("List all configured secrets")
  .action(async () => {
    await secretListCommand();
  });

program
  .command("init")
  .description("Initialize a new Cell (generate cell.yaml skeleton)")
  .argument("[name]", "Cell name")
  .action(async (name?: string) => {
    await initCommand(name);
  });

const domain = program.command("domain").description("List or inspect domain configuration");

domain
  .command("list")
  .description("List configured domain aliases and hosts (use with cell deploy --domain <alias>)")
  .option("-i, --instance <name>", "Use cell.<name>.yaml param overrides for this instance")
  .action(async (opts) => {
    await run(() => domainListCommand({ instance: opts.instance }));
  });

// --- cognito command group ---
const cognito = program.command("cognito").description("Manage Cognito User Pool, App Clients, and Identity Providers");

const cognitoPool = cognito.command("pool").description("Manage Cognito User Pools");

cognitoPool
  .command("create")
  .description("Create a new User Pool")
  .requiredOption("--name <name>", "User Pool name")
  .option("--region <region>", "AWS region")
  .option("--domain <prefix>", "Hosted UI domain prefix")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    await run(() => poolCreateCommand(opts));
  });

cognitoPool
  .command("describe")
  .description("Describe an existing User Pool")
  .option("--pool-id <id>", "User Pool ID")
  .option("--region <region>", "AWS region")
  .action(async (opts) => {
    await run(() => poolDescribeCommand(opts));
  });

const cognitoClient = cognito.command("client").description("Manage Cognito App Clients");

cognitoClient
  .command("create")
  .description("Create a new App Client")
  .requiredOption("--name <name>", "App Client name")
  .option("--pool-id <id>", "User Pool ID")
  .option("--region <region>", "AWS region")
  .option("--callback-urls <urls>", "Comma-separated callback URLs")
  .option("--logout-urls <urls>", "Comma-separated logout URLs")
  .option("--providers <providers>", "Comma-separated identity providers (default: Google,Microsoft)")
  .option("--generate-secret", "Generate a client secret")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    await run(() =>
      clientCreateCommand({
        name: opts.name,
        poolId: opts.poolId,
        region: opts.region,
        callbackUrls: opts.callbackUrls,
        logoutUrls: opts.logoutUrls,
        providers: opts.providers,
        generateSecret: opts.generateSecret,
        yes: opts.yes,
      })
    );
  });

cognitoClient
  .command("sync-urls")
  .description("Add callback/logout URLs to an App Client")
  .option("--pool-id <id>", "User Pool ID")
  .option("--client-id <id>", "App Client ID")
  .option("--region <region>", "AWS region")
  .option("--add-callback <url>", "Callback URL to add (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--add-logout <url>", "Logout URL to add (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    await run(() =>
      clientSyncUrlsCommand({
        poolId: opts.poolId,
        clientId: opts.clientId,
        region: opts.region,
        addCallback: opts.addCallback,
        addLogout: opts.addLogout,
        yes: opts.yes,
      })
    );
  });

const cognitoIdp = cognito.command("idp").description("Manage Cognito Identity Providers");

cognitoIdp
  .command("setup")
  .description("Create or update an identity provider (Google / Microsoft)")
  .requiredOption("--provider <provider>", 'Provider name: "google" or "microsoft"')
  .option("--pool-id <id>", "User Pool ID")
  .option("--region <region>", "AWS region")
  .option("--client-id <id>", "OAuth client ID (falls back to env var)")
  .option("--client-secret <secret>", "OAuth client secret (falls back to env var)")
  .option("--tenant <tenant>", 'Microsoft tenant ID (default: "common")')
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    await run(() => idpSetupCommand(opts));
  });

cognitoIdp
  .command("sync")
  .description("Sync all IdP credentials from environment variables")
  .option("--pool-id <id>", "User Pool ID")
  .option("--region <region>", "AWS region")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    await run(() => idpSyncCommand(opts));
  });

program.parse();
