import { api } from "@casfa/client";
import type { Command } from "commander";
import { getProfile, loadConfig } from "../lib/config";
import { createFormatter, formatSize } from "../lib/output";

export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description("Show service information")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        // For info, we just need to call the info API directly
        const config = loadConfig();
        const profileName = opts.profile || config.currentProfile;
        const profile = getProfile(config, profileName);
        const baseUrl = opts.baseUrl || profile.baseUrl;

        const result = await api.fetchServiceInfo(baseUrl);

        if (!result.ok) {
          formatter.error(`Failed to get service info: ${result.error.message}`);
          process.exit(1);
        }

        const info = result.data;
        formatter.output(info, () => {
          const lines = [
            `Service:    ${info.service}`,
            `Version:    ${info.version}`,
            `Storage:    ${info.storage}`,
            `Auth:       ${info.auth}`,
            `Database:   ${info.database}`,
            "",
            "Limits:",
            `  Max Node Size:       ${formatSize(info.limits.maxNodeSize)}`,
            `  Max Name Bytes:      ${info.limits.maxNameBytes}`,
            `  Max Collection Size: ${info.limits.maxCollectionChildren}`,
            `  Max Payload Size:    ${formatSize(info.limits.maxPayloadSize)}`,
            `  Max Ticket TTL:      ${info.limits.maxTicketTtl}s`,
            `  Max Token TTL:       ${info.limits.maxAgentTokenTtl}s`,
            "",
            "Features:",
            `  JWT Auth:     ${info.features.jwtAuth ? "✓" : "✗"}`,
            `  OAuth Login:  ${info.features.oauthLogin ? "✓" : "✗"}`,
          ];
          return lines.join("\n");
        });

        formatter.debug(`Profile: ${profileName}`);
        formatter.debug(`Base URL: ${baseUrl}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
