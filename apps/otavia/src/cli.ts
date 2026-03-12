#!/usr/bin/env bun
import { Command } from "commander";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .name("otavia")
  .description("CLI for Otavia stack")
  .version("0.1.0");

const placeholderAction = async () => {
  console.log("Not implemented");
};

program.hook("preAction", () => {
  const configPath = path.join(process.cwd(), "otavia.yaml");
  if (!fs.existsSync(configPath)) {
    console.error("otavia.yaml not found");
    process.exit(1);
  }
});

program.command("setup").description("Setup Otavia stack").action(placeholderAction);
program.command("dev").description("Start development").action(placeholderAction);
program.command("test").description("Run tests").action(placeholderAction);
program.command("test:unit").description("Run unit tests").action(placeholderAction);
program.command("test:e2e").description("Run e2e tests").action(placeholderAction);
program.command("deploy").description("Deploy stack").action(placeholderAction);
program.command("typecheck").description("Type check").action(placeholderAction);
program.command("lint").description("Lint").action(placeholderAction);
program.command("clean").description("Clean artifacts").action(placeholderAction);

const aws = program.command("aws").description("AWS-related commands");
aws.command("login").description("AWS login").action(placeholderAction);
aws.command("logout").description("AWS logout").action(placeholderAction);

program.parse();
