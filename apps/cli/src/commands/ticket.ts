import { api } from "@casfa/client";
import type { Command } from "commander";
import { createClient, requireRealmAuth } from "../lib/client";
import { createFormatter, formatRelativeTime } from "../lib/output";

/**
 * Get an access token from the client (auto-refreshes if needed).
 */
async function getAccessTokenBase64(
  resolved: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  const at = await resolved.client.getAccessToken();
  if (!at) {
    throw new Error("Authentication required. Run 'casfa auth login'.");
  }
  return at.tokenBase64;
}

export function registerTicketCommands(program: Command): void {
  const ticket = program.command("ticket").description("Ticket management (temporary access)");

  ticket
    .command("create")
    .description("Create a new ticket bound to the current access token")
    .requiredOption("-t, --title <text>", "ticket title/description")
    .action(async (cmdOpts: { title: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        // Get an access token (auto-refreshes if needed)
        const accessToken = await getAccessTokenBase64(resolved);

        // Create ticket — server derives accessTokenId from the auth token
        const ticketResult = await api.createTicket(
          resolved.baseUrl,
          resolved.realm,
          accessToken,
          { title: cmdOpts.title }
        );

        if (!ticketResult.ok) {
          formatter.error(`Failed to create ticket: ${ticketResult.error.message}`);
          process.exit(1);
        }

        const ticketInfo = ticketResult.data;
        formatter.output(ticketInfo, () => {
          const lines = [
            `Ticket ID:       ${ticketInfo.ticketId}`,
            `Title:           ${ticketInfo.title}`,
            `Status:          ${ticketInfo.status}`,
            `Access Token ID: ${ticketInfo.accessTokenId}`,
            "",
            "Use with: casfa --ticket <ticket-id> --realm <realm> node get <key>",
          ];
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  ticket
    .command("list")
    .alias("ls")
    .description("List tickets")
    .option("-s, --status <status>", "filter by status: pending|submitted")
    .option("-l, --limit <n>", "number of results", "20")
    .action(async (cmdOpts: { status?: string; limit: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const accessToken = await getAccessTokenBase64(resolved);

        const params: { limit: number; status?: "pending" | "submitted" } = {
          limit: parseInt(cmdOpts.limit, 10),
        };
        if (cmdOpts.status === "pending" || cmdOpts.status === "submitted") {
          params.status = cmdOpts.status;
        }

        const result = await api.listTickets(
          resolved.baseUrl,
          resolved.realm,
          accessToken,
          params
        );

        if (!result.ok) {
          formatter.error(`Failed to list tickets: ${result.error.message}`);
          process.exit(1);
        }

        const tickets = result.data.tickets;
        formatter.output(tickets, () => {
          if (tickets.length === 0) {
            return "No tickets found.";
          }

          const header = `${"ID".padEnd(32)}  STATUS      ${"TITLE".padEnd(24)}  CREATED`;
          const lines = tickets.map((t) => {
            const status = t.status.padEnd(10);
            const title = (t.title || "—").slice(0, 22).padEnd(24);
            const created = formatRelativeTime(t.createdAt * 1000);
            return `${t.ticketId.slice(0, 30).padEnd(32)}  ${status}  ${title}  ${created}`;
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

        const accessToken = await getAccessTokenBase64(resolved);

        const result = await api.getTicket(resolved.baseUrl, resolved.realm, accessToken, ticketId);
        if (!result.ok) {
          formatter.error(`Failed to get ticket: ${result.error.message}`);
          process.exit(1);
        }

        const t = result.data;
        formatter.output(t, () => {
          const lines = [
            `ID:              ${t.ticketId}`,
            `Title:           ${t.title || "(none)"}`,
            `Status:          ${t.status}`,
            `Access Token ID: ${t.accessTokenId}`,
            `Creator:         ${t.creatorIssuerId}`,
            `Created:         ${new Date(t.createdAt * 1000).toISOString()}`,
            `Expires:         ${new Date(t.expiresAt * 1000).toISOString()}`,
          ];

          if (t.root) {
            lines.push(`Root:            ${t.root}`);
          }
          if (t.submittedAt) {
            lines.push(`Submitted:       ${new Date(t.submittedAt * 1000).toISOString()}`);
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
    .description("Submit ticket result")
    .requiredOption("-r, --root <key>", "output root node key")
    .action(async (ticketId: string, cmdOpts: { root: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const accessToken = await getAccessTokenBase64(resolved);

        const result = await api.submitTicket(
          resolved.baseUrl,
          resolved.realm,
          accessToken,
          ticketId,
          { root: cmdOpts.root }
        );

        if (!result.ok) {
          formatter.error(`Failed to submit: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Submitted ticket: ${ticketId}`);
        formatter.info(`Root: ${result.data.root}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
