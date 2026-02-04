import type { Command } from "commander";
import { parseSize } from "../lib/cache";
import { createClient, requireRealm, requireRealmAuth } from "../lib/client";
import { createFormatter, formatRelativeTime, formatSize } from "../lib/output";

export function registerTicketCommands(program: Command): void {
  const ticket = program.command("ticket").description("Ticket management (temporary access)");

  ticket
    .command("create")
    .description("Create a new ticket")
    .option("-i, --input <keys>", "input node keys (comma-separated)")
    .option("-p, --purpose <text>", "purpose description")
    .option("-w, --writable", "allow writing")
    .option("-q, --quota <bytes>", "write quota (e.g., 10MB)")
    .option("-a, --accept <types>", "allowed MIME types (comma-separated)")
    .option("-t, --ttl <seconds>", "TTL in seconds", "3600")
    .action(
      async (cmdOpts: {
        input?: string;
        purpose?: string;
        writable?: boolean;
        quota?: string;
        accept?: string;
        ttl: string;
      }) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        try {
          const resolved = await createClient(opts);
          requireRealmAuth(resolved);

          const createOpts: {
            input?: string[];
            purpose?: string;
            writable?: {
              quota?: number;
              accept?: string[];
            };
            expiresIn?: number;
          } = {
            expiresIn: parseInt(cmdOpts.ttl, 10),
          };

          if (cmdOpts.input) {
            createOpts.input = cmdOpts.input.split(",").map((s) => s.trim());
          }

          if (cmdOpts.purpose) {
            createOpts.purpose = cmdOpts.purpose;
          }

          if (cmdOpts.writable) {
            createOpts.writable = {};
            if (cmdOpts.quota) {
              createOpts.writable.quota = parseSize(cmdOpts.quota);
            }
            if (cmdOpts.accept) {
              createOpts.writable.accept = cmdOpts.accept.split(",").map((s) => s.trim());
            }
          }

          const result = await resolved.client.tickets.create(createOpts);
          if (!result.ok) {
            formatter.error(`Failed to create ticket: ${result.error.message}`);
            process.exit(1);
          }

          const ticketInfo = result.data;
          formatter.output(ticketInfo, () => {
            const lines = [
              `Ticket ID:  ${ticketInfo.ticketId}`,
              `Realm ID:   ${ticketInfo.realmId}`,
              `Expires At: ${new Date(ticketInfo.expiresAt * 1000).toISOString()}`,
              "",
              "Use with: casfa --ticket <ticket-id> --realm <realm> node get <key>",
            ];
            return lines.join("\n");
          });
        } catch (error) {
          formatter.error((error as Error).message);
          process.exit(1);
        }
      }
    );

  ticket
    .command("list")
    .alias("ls")
    .description("List tickets")
    .option("-s, --status <status>", "filter by status: issued|committed|revoked|archived")
    .action(async (cmdOpts: { status?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.tickets.list();

        if (!result.ok) {
          formatter.error(`Failed to list tickets: ${result.error.message}`);
          process.exit(1);
        }

        const tickets = result.data.items;
        formatter.output(tickets, () => {
          if (tickets.length === 0) {
            return "No tickets found.";
          }

          const header = `${"ID".padEnd(32)}  REVOKED  ${"  LABEL".padEnd(30)}  EXPIRES`;
          const lines = tickets.map((t) => {
            const revoked = t.isRevoked ? "yes" : "no ";
            const label = (t.label || "—").slice(0, 28);
            const expires = t.expiresAt ? formatRelativeTime(t.expiresAt * 1000) : "—";
            return `${t.ticketId}  ${revoked.padEnd(8)}  ${label.padEnd(28)}  ${expires}`;
          });

          return [header, ...lines].join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  ticket
    .command("show <ticket-id>")
    .description("Show ticket details")
    .action(async (ticketId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.tickets.get(ticketId);
        if (!result.ok) {
          formatter.error(`Failed to get ticket: ${result.error.message}`);
          process.exit(1);
        }

        const t = result.data;
        formatter.output(t, () => {
          const lines = [
            `ID:       ${t.ticketId}`,
            `Realm:    ${t.realmId}`,
            `Issuer:   ${t.issuerId}`,
            `Revoked:  ${t.isRevoked ? "yes" : "no"}`,
            `Created:  ${new Date(t.createdAt * 1000).toISOString()}`,
            `Expires:  ${new Date(t.expiresAt * 1000).toISOString()}`,
          ];

          if (t.label) {
            lines.push(`Label:    ${t.label}`);
          }

          if (t.scope && t.scope.length > 0) {
            lines.push(`Scope:    ${t.scope.join(", ")}`);
          }

          if (t.writable) {
            lines.push(`Writable: yes`);
            if (t.writable.quota) {
              lines.push(`  Quota:  ${formatSize(t.writable.quota)}`);
            }
            if (t.writable.accept) {
              lines.push(`  Accept: ${t.writable.accept.join(", ")}`);
            }
          }

          if (t.output) {
            lines.push(`Output:   ${t.output}`);
          }

          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  ticket
    .command("submit <ticket-id>")
    .description("Submit ticket result (when using ticket auth)")
    .option("-o, --output <key>", "output node key")
    .action(async (ticketId: string, cmdOpts: { output?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        // For submitting, we need to be authenticated with the ticket itself
        if (resolved.type !== "ticket") {
          formatter.error("Ticket submission requires ticket authentication. Use --ticket option.");
          process.exit(1);
        }

        if (!cmdOpts.output) {
          formatter.error("--output is required");
          process.exit(1);
        }

        const result = await resolved.client.ticket.commit({ output: cmdOpts.output });

        if (!result.ok) {
          formatter.error(`Failed to submit: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Submitted ticket: ${ticketId}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  ticket
    .command("revoke <ticket-id>")
    .description("Revoke a ticket")
    .action(async (ticketId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.tickets.revoke(ticketId);
        if (!result.ok) {
          formatter.error(`Failed to revoke: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Revoked ticket: ${ticketId}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
