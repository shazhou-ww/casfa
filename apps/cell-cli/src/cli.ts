import { Command } from "commander";
import { devCommand } from "./commands/dev.js";
import { buildCommand } from "./commands/build.js";

const program = new Command();

program
  .name("cell")
  .description("CLI for casfa Cell services")
  .version("0.0.1");

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
  .command("test")
  .description("Run all tests (unit + e2e)")
  .action(() => {
    console.log("cell test: not yet implemented");
  });

program
  .command("deploy")
  .description("Deploy to cloud")
  .action(() => {
    console.log("cell deploy: not yet implemented");
  });

program
  .command("lint")
  .description("Run linter")
  .option("--fix", "Auto-fix issues")
  .action(() => {
    console.log("cell lint: not yet implemented");
  });

program
  .command("typecheck")
  .description("Run TypeScript type checking")
  .action(() => {
    console.log("cell typecheck: not yet implemented");
  });

program
  .command("logs")
  .description("View CloudWatch logs")
  .action(() => {
    console.log("cell logs: not yet implemented");
  });

program
  .command("status")
  .description("View CloudFormation stack status")
  .action(() => {
    console.log("cell status: not yet implemented");
  });

const secret = program
  .command("secret")
  .description("Manage secrets in Secrets Manager");

secret
  .command("set <key>")
  .description("Set a secret value")
  .action((key: string) => {
    console.log(`cell secret set ${key}: not yet implemented`);
  });

secret
  .command("get <key>")
  .description("Get a secret value")
  .action((key: string) => {
    console.log(`cell secret get ${key}: not yet implemented`);
  });

secret
  .command("list")
  .description("List all configured secrets")
  .action(() => {
    console.log("cell secret list: not yet implemented");
  });

program
  .command("init")
  .description("Initialize a new Cell (generate cell.yaml skeleton)")
  .action(() => {
    console.log("cell init: not yet implemented");
  });

program.parse();
