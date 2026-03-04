import { Command } from "commander";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";
import { devCommand } from "./commands/dev.js";
import { initCommand } from "./commands/init.js";
import { lintCommand } from "./commands/lint.js";
import { logsCommand } from "./commands/logs.js";
import { secretGetCommand, secretListCommand, secretSetCommand } from "./commands/secret.js";
import { statusCommand } from "./commands/status.js";
import { testCommand, testE2eCommand, testUnitCommand } from "./commands/test.js";
import { typecheckCommand } from "./commands/typecheck.js";

const program = new Command();

program.name("cell").description("CLI for casfa Cell services").version("0.0.1");

program
  .command("dev")
  .description("Start local development environment")
  .action(async () => {
    await devCommand();
  });

program
  .command("build")
  .description("Build frontend and backend artifacts")
  .action(async () => {
    await buildCommand();
  });

program
  .command("deploy")
  .description("Deploy to cloud")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    await deployCommand({ yes: opts.yes });
  });

program
  .command("test")
  .description("Run all tests (unit + e2e)")
  .action(async () => {
    await testCommand();
  });

program
  .command("test:unit")
  .description("Run unit tests")
  .action(async () => {
    await testUnitCommand();
  });

program
  .command("test:e2e")
  .description("Run e2e tests")
  .action(async () => {
    await testE2eCommand();
  });

program
  .command("lint")
  .description("Run linter")
  .option("--fix", "Auto-fix issues")
  .action(async (opts) => {
    await lintCommand({ fix: opts.fix });
  });

program
  .command("typecheck")
  .description("Run TypeScript type checking")
  .action(async () => {
    await typecheckCommand();
  });

program
  .command("logs")
  .description("View CloudWatch logs")
  .option("--follow", "Follow log output")
  .action(async (opts) => {
    await logsCommand({ follow: opts.follow });
  });

program
  .command("status")
  .description("View CloudFormation stack status")
  .action(async () => {
    await statusCommand();
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

program.parse();
