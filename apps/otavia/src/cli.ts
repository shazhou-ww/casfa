#!/usr/bin/env bun
import { Command } from "commander";
import { loadOtaviaYaml } from "./config/load-otavia-yaml.js";
import { setupCommand } from "./commands/setup.js";
import { cleanCommand } from "./commands/clean.js";
import { awsLoginCommand, awsLogoutCommand } from "./commands/aws.js";
import { devCommand } from "./commands/dev.js";
import { testUnitCommand, testE2eCommand } from "./commands/test.js";
import { typecheckCommand } from "./commands/typecheck.js";
import { lintCommand } from "./commands/lint.js";
import { deployCommand } from "./commands/deploy.js";

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
  .action(
    async (
      _args: unknown,
      cmd: {
        opts: () => { tunnel?: boolean };
        getOptionValueSource: (name: string) => string | undefined;
      }
    ) => {
      const opts = cmd.opts();
      const source = cmd.getOptionValueSource("tunnel");
      await setupCommand(process.cwd(), { tunnel: opts.tunnel, tunnelSpecified: source === "cli" });
    }
  );
program.command("dev")
  .description("Start development")
  .option("--tunnel", "Enable cloudflared tunnel and use tunnel host URLs")
  .option("--tunnel-host <host>", "Tunnel hostname or full URL used as public base URL")
  .option("--tunnel-config <path>", "Path to cloudflared config.yml")
  .option("--tunnel-protocol <protocol>", "Tunnel transport protocol: quic, http2, or auto")
  .action(
    async (
      _args: unknown,
      cmd: {
        opts: () => {
          tunnel?: boolean;
          tunnelHost?: string;
          tunnelConfig?: string;
          tunnelProtocol?: string;
        };
      }
    ) => {
      const opts = cmd.opts();
      await devCommand(process.cwd(), {
        tunnel: opts.tunnel,
        tunnelHost: opts.tunnelHost,
        tunnelConfig: opts.tunnelConfig,
        tunnelProtocol: opts.tunnelProtocol,
      });
    }
  );
program.command("test")
  .description("Run tests (unit then e2e)")
  .action(async () => {
    const rootDir = process.cwd();
    await testUnitCommand(rootDir);
    await testE2eCommand(rootDir);
  });
program.command("test:unit")
  .description("Run unit tests")
  .action(async () => {
    await testUnitCommand(process.cwd());
  });
program.command("test:e2e")
  .description("Run e2e tests")
  .action(async () => {
    await testE2eCommand(process.cwd());
  });
program.command("deploy")
  .description("Deploy stack (build, upload, CloudFormation)")
  .option("--yes", "Skip confirmation")
  .action(async (_args: unknown, cmd: { opts: () => { yes?: boolean } }) => {
    await deployCommand(process.cwd(), { yes: cmd.opts().yes });
  });
program
  .command("typecheck")
  .description("Type check all cells")
  .action(async () => {
    await typecheckCommand(process.cwd());
  });
program
  .command("lint")
  .description("Lint all cells")
  .option("--fix", "Apply safe fixes")
  .option("--unsafe", "Apply unsafe fixes")
  .action(async (_args: unknown, cmd: { opts: () => { fix?: boolean; unsafe?: boolean } }) => {
    const opts = cmd.opts();
    await lintCommand(process.cwd(), { fix: opts.fix, unsafe: opts.unsafe });
  });
program.command("clean").description("Clean artifacts").action(() => {
  cleanCommand(process.cwd());
});

const aws = program.command("aws").description("AWS-related commands");
aws.command("login").description("AWS login").action(async () => { await awsLoginCommand(process.cwd()); });
aws.command("logout").description("AWS logout").action(async () => { await awsLogoutCommand(process.cwd()); });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
