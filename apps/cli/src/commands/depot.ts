import type { Command } from "commander";
import { createClient, requireRealmAuth } from "../lib/client";
import { createFormatter, formatRelativeTime } from "../lib/output";

export function registerDepotCommands(program: Command): void {
  const depot = program.command("depot").description("Depot management (versioned storage)");

  depot
    .command("list")
    .alias("ls")
    .description("List all depots")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.depots.list();
        if (!result.ok) {
          formatter.error(`Failed to list depots: ${result.error.message}`);
          process.exit(1);
        }

        const response = result.data as { items?: unknown[]; depots?: unknown[] };
        const depots = (response.items ?? response.depots ?? []) as Array<Record<string, unknown>>;
        formatter.output(depots, () => {
          if (depots.length === 0) {
            return "No depots found.";
          }

          const lines = depots.map((d) => {
            const title = (d.title as string) || "(untitled)";
            const root = d.root ? `${String(d.root).slice(0, 20)}...` : "(empty)";
            const updated = d.updatedAt ? formatRelativeTime(d.updatedAt as number) : "—";
            return `${d.depotId}  ${title.padEnd(20)}  ${root.padEnd(25)}  ${updated}`;
          });

          return [
            `${"ID".padEnd(32)}  ${"TITLE".padEnd(20)}  ${"ROOT".padEnd(25)}  UPDATED`,
            ...lines,
          ].join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  depot
    .command("create")
    .description("Create a new depot")
    .option("-t, --title <title>", "depot title")
    .option("-m, --max-history <n>", "maximum history entries", "10")
    .action(async (cmdOpts: { title?: string; maxHistory: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.depots.create({
          title: cmdOpts.title,
          maxHistory: parseInt(cmdOpts.maxHistory, 10),
        });

        if (!result.ok) {
          formatter.error(`Failed to create depot: ${result.error.message}`);
          process.exit(1);
        }

        formatter.output(result.data, () => {
          return `Created depot: ${result.data.depotId}`;
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  depot
    .command("show <depot-id>")
    .description("Show depot details")
    .action(async (depotId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.depots.get(depotId);
        if (!result.ok) {
          formatter.error(`Failed to get depot: ${result.error.message}`);
          process.exit(1);
        }

        const depot = result.data;
        formatter.output(depot, () => {
          const lines = [
            `ID:          ${depot.depotId}`,
            `Title:       ${depot.title || "(untitled)"}`,
            `Root:        ${depot.root || "(empty)"}`,
            `Max History: ${depot.maxHistory}`,
            `Created:     ${new Date(depot.createdAt).toISOString()}`,
            `Updated:     ${new Date(depot.updatedAt).toISOString()}`,
          ];

          if (depot.history && depot.history.length > 0) {
            lines.push("");
            lines.push("History:");
            for (const h of depot.history) {
              lines.push(`  ${h.root}  (${new Date(h.timestamp).toISOString()})`);
            }
          }

          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  depot
    .command("commit <depot-id> <root-key>")
    .description("Commit a new root to the depot")
    .action(async (depotId: string, rootKey: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.depots.commit(depotId, { root: rootKey });
        if (!result.ok) {
          formatter.error(`Failed to commit: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Committed ${rootKey} to ${depotId}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  depot
    .command("update <depot-id>")
    .description("Update depot settings")
    .option("-t, --title <title>", "new title")
    .option("-m, --max-history <n>", "maximum history entries")
    .action(async (depotId: string, cmdOpts: { title?: string; maxHistory?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const updateParams: { title?: string; maxHistory?: number } = {};
        if (cmdOpts.title) {
          updateParams.title = cmdOpts.title;
        }
        if (cmdOpts.maxHistory) {
          updateParams.maxHistory = parseInt(cmdOpts.maxHistory, 10);
        }

        if (Object.keys(updateParams).length === 0) {
          formatter.error("No updates specified. Use --title or --max-history.");
          process.exit(1);
        }

        const result = await resolved.client.depots.update(depotId, updateParams);
        if (!result.ok) {
          formatter.error(`Failed to update depot: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Updated depot: ${depotId}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  depot
    .command("delete <depot-id>")
    .description("Delete a depot")
    .action(async (depotId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.depots.delete(depotId);
        if (!result.ok) {
          formatter.error(`Failed to delete depot: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Deleted depot: ${depotId}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
