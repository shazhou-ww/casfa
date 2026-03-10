#!/usr/bin/env bun

import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth";
import { registerCacheCommands } from "./commands/cache";
import { registerCompletionCommands } from "./commands/completion";
import { registerConfigCommands } from "./commands/config";
import { registerDelegateCommands } from "./commands/delegate";
import { registerDepotCommands } from "./commands/depot";
import { registerInfoCommand } from "./commands/info";
import { registerNodeCommands } from "./commands/node";
import { registerRealmCommands } from "./commands/realm";

const program = new Command();

program
  .name("casfa")
  .description("CLI for CASFA content-addressable storage service")
  .version("0.1.0")
  .option("-p, --profile <name>", "use specified profile")
  .option("--base-url <url>", "override service base URL")
  .option("--realm <realm-id>", "specify realm ID")
  .option("--no-cache", "disable local cache")
  .option("-f, --format <type>", "output format: text|json|yaml|table", "text")
  .option("-v, --verbose", "verbose output")
  .option("-q, --quiet", "quiet mode");

// Register all command groups
registerConfigCommands(program);
registerAuthCommands(program);
registerInfoCommand(program);
registerNodeCommands(program);
registerDepotCommands(program);
registerDelegateCommands(program);
registerRealmCommands(program);
registerCacheCommands(program);
registerCompletionCommands(program);

// Global error handler
program.exitOverride();

async function main() {
  try {
    await program.parseAsync(process.argv);
    // If no subcommand is provided, show help
    if (process.argv.length <= 2) {
      program.outputHelp();
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      // CommanderError for --help, --version, etc.
      if ("code" in error) {
        const code = (error as { code: string }).code;
        if (
          code === "commander.helpDisplayed" ||
          code === "commander.version" ||
          code === "commander.help"
        ) {
          process.exit(0);
        }
      }
      console.error(`Error: ${error.message}`);
    } else {
      console.error("An unexpected error occurred");
    }
    process.exit(1);
  }
}

main();
