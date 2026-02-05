import { api } from "@casfa/client";
import type { Command } from "commander";
import { parseSize } from "../lib/cache";
import { createClient, requireAuth, requireRealm } from "../lib/client";
import { createFormatter, formatRelativeTime, formatSize } from "../lib/output";

export function registerTicketCommands(program: Command): void {
  const ticket = program.command("ticket").description("Ticket management (temporary access)");

  ticket
    .command("create")
    .description("Create a new ticket (two-step: issue access token + bind ticket)")
    .option("-t, --title <text>", "ticket title/description")
    .option("--ttl <seconds>", "token TTL in seconds", "3600")
    .option("--can-upload", "allow upload operations", true)
    .option("--no-can-upload", "disallow upload operations")
    .option("--scope <paths>", "scope paths (comma-separated)")
    .action(
      async (cmdOpts: {
        title?: string;
        ttl: string;
        canUpload: boolean;
        scope?: string;
      }) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        try {
          const resolved = await createClient(opts);
          requireRealm(resolved);
          requireAuth(resolved);

          const state = resolved.client.getState();

          // Step 1: Issue Access Token using Delegate Token or User JWT
          let accessTokenBase64: string;
          let accessTokenId: string;

          if (state.delegate) {
            // Use Delegate Token to issue Access Token
            const tokenResult = await api.delegateToken(
              resolved.baseUrl,
              state.delegate.tokenBase64,
              {
                name: cmdOpts.title || "ticket-access-token",
                type: "access",
                expiresIn: parseInt(cmdOpts.ttl, 10),
                canUpload: cmdOpts.canUpload,
                canManageDepot: false,
                scope: cmdOpts.scope ? cmdOpts.scope.split(",").map((s) => s.trim()) : undefined,
              }
            );

            if (!tokenResult.ok) {
              formatter.error(`Failed to issue access token: ${tokenResult.error.message}`);
              process.exit(1);
            }

            accessTokenBase64 = tokenResult.data.token;
            accessTokenId = tokenResult.data.tokenId;
          } else if (state.user) {
            // Use User JWT to create Access Token
            const tokenResult = await api.createToken(
              resolved.baseUrl,
              state.user.accessToken,
              {
                realm: resolved.realm,
                name: cmdOpts.title || "ticket-access-token",
                type: "access",
                expiresIn: parseInt(cmdOpts.ttl, 10),
                canUpload: cmdOpts.canUpload,
                canManageDepot: false,
                scope: cmdOpts.scope ? cmdOpts.scope.split(",").map((s) => s.trim()) : undefined,
              }
            );

            if (!tokenResult.ok) {
              formatter.error(`Failed to create access token: ${tokenResult.error.message}`);
              process.exit(1);
            }

            accessTokenBase64 = tokenResult.data.token;
            accessTokenId = tokenResult.data.tokenId;
          } else {
            formatter.error(
              "Authentication required. Run 'casfa auth login' or provide --delegate-token."
            );
            process.exit(1);
          }

          // Step 2: Create Ticket and bind Access Token
          // For creating ticket, we need an access token to authenticate the request
          // Use the newly created access token itself
          const ticketResult = await api.createTicket(
            resolved.baseUrl,
            resolved.realm,
            accessTokenBase64,
            {
              title: cmdOpts.title,
              accessTokenId,
            }
          );

          if (!ticketResult.ok) {
            formatter.error(`Failed to create ticket: ${ticketResult.error.message}`);
            process.exit(1);
          }

          const ticketInfo = ticketResult.data;
          formatter.output(
            { ...ticketInfo, accessToken: accessTokenBase64 },
            () => {
              const lines = [
                `Ticket ID:    ${ticketInfo.ticketId}`,
                `Realm ID:     ${resolved.realm}`,
                `Access Token: ${accessTokenBase64}`,
                `Expires At:   ${ticketInfo.expiresAt ? new Date(ticketInfo.expiresAt * 1000).toISOString() : "N/A"}`,
                "",
                "Use with: casfa --ticket <ticket-id> --realm <realm> node get <key>",
              ];
              return lines.join("\n");
            }
          );
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
    .option("-s, --status <status>", "filter by status: issued|submitted|revoked")
    .action(async (cmdOpts: { status?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);
        requireAuth(resolved);

        const state = resolved.client.getState();
        let accessToken: string;

        if (state.access) {
          accessToken = state.access.tokenBase64;
        } else if (state.delegate) {
          // Issue a temporary access token for listing
          const tokenResult = await api.delegateToken(
            resolved.baseUrl,
            state.delegate.tokenBase64,
            {
              name: "cli-list-tickets",
              type: "access",
              expiresIn: 300, // 5 minutes
              canUpload: false,
              canManageDepot: false,
            }
          );

          if (!tokenResult.ok) {
            formatter.error(`Failed to get access token: ${tokenResult.error.message}`);
            process.exit(1);
          }

          accessToken = tokenResult.data.token;
        } else if (state.user) {
          // Create access token using user JWT
          const tokenResult = await api.createToken(
            resolved.baseUrl,
            state.user.accessToken,
            {
              realm: resolved.realm,
              name: "cli-list-tickets",
              type: "access",
              expiresIn: 300,
              canUpload: false,
              canManageDepot: false,
            }
          );

          if (!tokenResult.ok) {
            formatter.error(`Failed to get access token: ${tokenResult.error.message}`);
            process.exit(1);
          }

          accessToken = tokenResult.data.token;
        } else {
          formatter.error("Authentication required.");
          process.exit(1);
        }

        const params: { status?: "issued" | "submitted" | "revoked" } = {};
        if (cmdOpts.status === "issued" || cmdOpts.status === "submitted" || cmdOpts.status === "revoked") {
          params.status = cmdOpts.status;
        }

        const result = await api.listTickets(resolved.baseUrl, resolved.realm, accessToken, params);

        if (!result.ok) {
          formatter.error(`Failed to list tickets: ${result.error.message}`);
          process.exit(1);
        }

        const tickets = result.data.tickets;
        formatter.output(tickets, () => {
          if (tickets.length === 0) {
            return "No tickets found.";
          }

          const header = `${"ID".padEnd(32)}  STATUS      ${"TITLE".padEnd(24)}  EXPIRES`;
          const lines = tickets.map((t) => {
            const status = t.status.padEnd(10);
            const title = (t.title || "—").slice(0, 22).padEnd(24);
            const expires = t.expiresAt ? formatRelativeTime(t.expiresAt * 1000) : "—";
            return `${t.ticketId.slice(0, 30).padEnd(32)}  ${status}  ${title}  ${expires}`;
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
        requireRealm(resolved);
        requireAuth(resolved);

        const state = resolved.client.getState();
        let accessToken: string;

        // Get access token similar to list command
        if (state.access) {
          accessToken = state.access.tokenBase64;
        } else if (state.delegate) {
          const tokenResult = await api.delegateToken(
            resolved.baseUrl,
            state.delegate.tokenBase64,
            { name: "cli-show-ticket", type: "access", expiresIn: 300, canUpload: false, canManageDepot: false }
          );
          if (!tokenResult.ok) {
            formatter.error(`Failed to get access token: ${tokenResult.error.message}`);
            process.exit(1);
          }
          accessToken = tokenResult.data.token;
        } else if (state.user) {
          const tokenResult = await api.createToken(
            resolved.baseUrl,
            state.user.accessToken,
            { realm: resolved.realm, name: "cli-show-ticket", type: "access", expiresIn: 300, canUpload: false, canManageDepot: false }
          );
          if (!tokenResult.ok) {
            formatter.error(`Failed to get access token: ${tokenResult.error.message}`);
            process.exit(1);
          }
          accessToken = tokenResult.data.token;
        } else {
          formatter.error("Authentication required.");
          process.exit(1);
        }

        const result = await api.getTicket(resolved.baseUrl, resolved.realm, accessToken, ticketId);
        if (!result.ok) {
          formatter.error(`Failed to get ticket: ${result.error.message}`);
          process.exit(1);
        }

        const t = result.data;
        formatter.output(t, () => {
          const lines = [
            `ID:       ${t.ticketId}`,
            `Realm:    ${t.realmId}`,
            `Status:   ${t.status}`,
            `Title:    ${t.title || "(none)"}`,
            `Issuer:   ${t.issuerId}`,
            `Created:  ${t.createdAt ? new Date(t.createdAt * 1000).toISOString() : "N/A"}`,
            `Expires:  ${t.expiresAt ? new Date(t.expiresAt * 1000).toISOString() : "N/A"}`,
          ];

          if (t.scope && t.scope.length > 0) {
            lines.push(`Scope:    ${t.scope.join(", ")}`);
          }

          if (t.root) {
            lines.push(`Root:     ${t.root}`);
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
        requireRealm(resolved);

        const state = resolved.client.getState();

        // For submitting, we need the access token that was bound to the ticket
        // This should be passed via --access-token option
        if (!state.access) {
          formatter.error(
            "Access token required for submission. Use --access-token option with the token bound to the ticket."
          );
          process.exit(1);
        }

        const result = await api.submitTicket(
          resolved.baseUrl,
          resolved.realm,
          state.access.tokenBase64,
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
