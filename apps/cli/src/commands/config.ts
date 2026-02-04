import type { Command } from "commander";
import enquirer from "enquirer";
import {
  createProfile,
  deleteProfile,
  getConfigPath,
  getConfigValue,
  listProfiles,
  loadConfig,
  saveConfig,
  setConfigValue,
} from "../lib/config";
import { createFormatter } from "../lib/output";

const { prompt } = enquirer;

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage CLI configuration");

  config
    .command("init")
    .description("Interactive configuration setup")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const answers = await prompt<{
          profileName: string;
          baseUrl: string;
          createAnother: boolean;
        }>([
          {
            type: "input",
            name: "profileName",
            message: "Profile name:",
            initial: "default",
          },
          {
            type: "input",
            name: "baseUrl",
            message: "Service base URL:",
            initial: "http://localhost:8801",
          },
        ]);

        const cfg = loadConfig();
        const existingProfile = cfg.profiles[answers.profileName];
        if (existingProfile) {
          existingProfile.baseUrl = answers.baseUrl;
        } else {
          createProfile(cfg, answers.profileName, answers.baseUrl);
        }
        cfg.currentProfile = answers.profileName;
        saveConfig(cfg);

        formatter.success(`Configuration saved to ${getConfigPath()}`);
        formatter.info(`Current profile: ${answers.profileName}`);
      } catch (error) {
        if ((error as Error).message?.includes("cancelled")) {
          formatter.info("Configuration cancelled");
          return;
        }
        throw error;
      }
    });

  config
    .command("list")
    .alias("ls")
    .description("List all profiles")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);
      const cfg = loadConfig();
      const profiles = listProfiles(cfg);

      formatter.output(profiles, () => {
        if (profiles.length === 0) {
          return "No profiles configured. Run 'casfa config init' to create one.";
        }
        return profiles
          .map((p) => {
            const marker = p.current ? "* " : "  ";
            return `${marker}${p.name.padEnd(15)} ${p.baseUrl}`;
          })
          .join("\n");
      });
    });

  config
    .command("set <key> <value>")
    .description(
      "Set a configuration value (baseUrl, realm, cache.enabled, cache.maxSize, cache.path)"
    )
    .action((key: string, value: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const cfg = loadConfig();
      setConfigValue(cfg, key, value);
      saveConfig(cfg);

      formatter.success(`Set ${key} = ${value}`);
    });

  config
    .command("get <key>")
    .description("Get a configuration value")
    .action((key: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const cfg = loadConfig();
      const value = getConfigValue(cfg, key);

      if (value === undefined) {
        formatter.error(`Configuration key "${key}" not found`);
        process.exit(1);
      }

      formatter.output({ key, value }, () => value);
    });

  config
    .command("use <profile>")
    .description("Switch to a profile")
    .action((profileName: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const cfg = loadConfig();
      if (!cfg.profiles[profileName]) {
        formatter.error(`Profile "${profileName}" does not exist`);
        formatter.info(`Available profiles: ${Object.keys(cfg.profiles).join(", ")}`);
        process.exit(1);
      }

      cfg.currentProfile = profileName;
      saveConfig(cfg);

      formatter.success(`Switched to profile: ${profileName}`);
      formatter.info(`Base URL: ${cfg.profiles[profileName].baseUrl}`);
    });

  config
    .command("path")
    .description("Show configuration file path")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);
      const configPath = getConfigPath();

      formatter.output({ path: configPath }, () => configPath);
    });

  config
    .command("create <name>")
    .description("Create a new profile")
    .option("--url <url>", "base URL", "http://localhost:8801")
    .action((name: string, cmdOpts: { url: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const cfg = loadConfig();
      createProfile(cfg, name, cmdOpts.url);
      saveConfig(cfg);

      formatter.success(`Created profile: ${name}`);
    });

  config
    .command("delete <name>")
    .description("Delete a profile")
    .action((name: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const cfg = loadConfig();
      deleteProfile(cfg, name);
      saveConfig(cfg);

      formatter.success(`Deleted profile: ${name}`);
    });
}
