#!/usr/bin/env bun
import { Command } from "commander";
import { loadOtaviaYaml } from "./config/load-otavia-yaml.js";
import { setupCommand } from "./commands/setup.js";
import { cleanCommand } from "./commands/clean.js";
import { awsLoginCommand, awsLogoutCommand } from "./commands/aws.js";
import { devCommand } from "./commands/dev.js";

const program = new Command();

program
  .name("otavia")
  .description("CLI for Otavia stack")
  .version("0.1.0");

const placeholderAction = async () => {
  console.log("Not implemented");
};

program.hook("preAction", () => {
  try {
    loadOtaviaYaml(process.cwd());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
});

program.command("setup")
  .description("Setup Otavia stack")
  .option("--tunnel", "Setup tunnel for remote dev")
  .action(async (_args: unknown, cmd: { opts: () => { tunnel?: boolean } }) => {
    await setupCommand(process.cwd(), { tunnel: cmd.opts().tunnel });
  });
program.command("dev").description("Start development").action(async () => {
  await devCommand(process.cwd());
});
program.command("test").description("Run tests").action(placeholderAction);
program.command("test:unit").description("Run unit tests").action(placeholderAction);
program.command("test:e2e").description("Run e2e tests").action(placeholderAction);
program.command("deploy").description("Deploy stack").action(placeholderAction);
program.command("typecheck").description("Type check").action(placeholderAction);
program.command("lint").description("Lint").action(placeholderAction);
program.command("clean").description("Clean artifacts").action(() => {
  cleanCommand(process.cwd());
});

const aws = program.command("aws").description("AWS-related commands");
aws.command("login").description("AWS login").action(async () => { await awsLoginCommand(process.cwd()); });
aws.command("logout").description("AWS logout").action(async () => { await awsLogoutCommand(process.cwd()); });

program.parse();
