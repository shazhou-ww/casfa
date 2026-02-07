#!/usr/bin/env bun

import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth";
import { registerCacheCommands } from "./commands/cache";
import { registerCompletionCommands } from "./commands/completion";
import { registerConfigCommands } from "./commands/config";
import { registerDepotCommands } from "./commands/depot";
import { registerInfoCommand } from "./commands/info";
import { registerNodeCommands } from "./commands/node";
import { registerRealmCommands } from "./commands/realm";
import { registerTicketCommands } from "./commands/ticket";

const program = new Command();

program
  .name("casfa")
  .description("CLI for CASFA v2 content-addressable storage service")
  .version("0.1.0")
  .option("-p, --profile <name>", "use specified profile")
  .option("--base-url <url>", "override service base URL")
  .option("--delegate-token <token>", "use delegate token for authentication")
  .option("--access-token <token>", "use access token directly (bypasses auto-issue)")
  .option("--token <token>", "DEPRECATED: use --delegate-token instead")
  .option("--ticket <ticket>", "use ticket for authentication")
  .option("--realm <realm-id>", "specify realm ID")
  .option("--no-cache", "disable local cache")
  .option("-f, --format <type>", "output format: text|json|yaml|table", "text")
  .option("-v, --verbose", "verbose output")
  .option("-q, --quiet", "quiet mode");

// Handle deprecated --token option
program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.token && !opts.delegateToken) {
    console.warn("\x1b[33mWarning: --token is deprecated, use --delegate-token instead\x1b[0m");
    // Copy token to delegateToken for backward compatibility
    opts.delegateToken = opts.token;
  }
});

// Register all command groups
registerConfigCommands(program);
registerAuthCommands(program);
registerInfoCommand(program);
registerNodeCommands(program);
registerDepotCommands(program);
registerTicketCommands(program);
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
