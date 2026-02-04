import type { Command } from "commander";
import { createClient, requireRealm } from "../lib/client";
import { createFormatter, formatSize } from "../lib/output";

export function registerRealmCommands(program: Command): void {
  const realm = program.command("realm").description("Realm information");

  realm
    .command("info")
    .description("Show current realm information")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        const result = await resolved.client.realm.getInfo();
        if (!result.ok) {
          formatter.error(`Failed to get realm info: ${result.error.message}`);
          process.exit(1);
        }

        const info = result.data as Record<string, unknown>;
        formatter.output(info, () => {
          const lines = [
            `Realm ID:       ${info.realmId ?? info.realm ?? "—"}`,
            `Node Limit:     ${info.nodeLimit ?? "—"}`,
            `Max Name Bytes: ${info.maxNameBytes ?? "—"}`,
          ];
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  realm
    .command("usage")
    .description("Show storage usage for current realm")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        const result = await resolved.client.realm.getUsage();
        if (!result.ok) {
          formatter.error(`Failed to get realm usage: ${result.error.message}`);
          process.exit(1);
        }

        const usage = result.data as Record<string, unknown>;
        formatter.output(usage, () => {
          const lines = [
            `Realm ID:     ${usage.realmId ?? usage.realm ?? "—"}`,
            `Nodes:        ${usage.nodeCount ?? 0}`,
            `Total Size:   ${formatSize((usage.totalBytes ?? 0) as number)}`,
          ];
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
