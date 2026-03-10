import type { Command } from "commander";
import { createClient, requireRealmAuth } from "../lib/client";
import { createFormatter, formatRelativeTime } from "../lib/output";

export function registerDelegateCommands(program: Command): void {
  const delegate = program
    .command("delegate")
    .description("Delegate management (child delegate creation and management)");

  // ── delegate create ───────────────────────────────────────────────────────
  delegate
    .command("create")
    .description("Create a child delegate")
    .option("-n, --name <name>", "delegate name")
    .option("--can-upload", "allow upload operations")
    .option("--no-can-upload", "disallow upload operations")
    .option("--can-manage-depot", "allow depot management")
    .option("--scope <paths>", "scope paths (comma-separated relative index paths)")
    .option("--ttl <seconds>", "token TTL in seconds")
    .option("--expires-in <seconds>", "delegate entity expiration in seconds")
    .action(
      async (cmdOpts: {
        name?: string;
        canUpload?: boolean;
        canManageDepot?: boolean;
        scope?: string;
        ttl?: string;
        expiresIn?: string;
      }) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        try {
          const resolved = await createClient(opts);
          requireRealmAuth(resolved);

          const result = await resolved.client.delegates.create({
            name: cmdOpts.name,
            canUpload: cmdOpts.canUpload ?? false,
            canManageDepot: cmdOpts.canManageDepot ?? false,
            scope: cmdOpts.scope ? cmdOpts.scope.split(",").map((s) => s.trim()) : undefined,
            tokenTtlSeconds: cmdOpts.ttl ? parseInt(cmdOpts.ttl, 10) : undefined,
            expiresIn: cmdOpts.expiresIn ? parseInt(cmdOpts.expiresIn, 10) : undefined,
          });

          if (!result.ok) {
            formatter.error(`Failed to create delegate: ${result.error.message}`);
            process.exit(1);
          }

          const data = result.data;
          formatter.output(data, () => {
            const lines = [
              `Delegate ID:    ${data.delegate.delegateId}`,
              `Name:           ${data.delegate.name || "(none)"}`,
              `Realm:          ${data.delegate.realm}`,
              `Parent ID:      ${data.delegate.parentId}`,
              `Depth:          ${data.delegate.depth}`,
              `Can Upload:     ${data.delegate.canUpload ? "yes" : "no"}`,
              `Can Manage:     ${data.delegate.canManageDepot ? "yes" : "no"}`,
              ``,
              `Refresh Token:  ${data.refreshToken.slice(0, 20)}...`,
              `Access Token:   ${data.accessToken.slice(0, 20)}...`,
              `AT Expires:     ${new Date(data.accessTokenExpiresAt).toISOString()}`,
              ``,
              `Store these tokens securely. The refresh token is needed to get new access tokens.`,
            ];
            return lines.join("\n");
          });
        } catch (error) {
          formatter.error((error as Error).message);
          process.exit(1);
        }
      }
    );

  // ── delegate list ─────────────────────────────────────────────────────────
  delegate
    .command("list")
    .alias("ls")
    .description("List child delegates")
    .option("-l, --limit <n>", "number of results", "20")
    .option("--include-revoked", "include revoked delegates")
    .action(async (cmdOpts: { limit: string; includeRevoked?: boolean }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.delegates.list({
          limit: parseInt(cmdOpts.limit, 10),
          includeRevoked: cmdOpts.includeRevoked ?? false,
        });

        if (!result.ok) {
          formatter.error(`Failed to list delegates: ${result.error.message}`);
          process.exit(1);
        }

        const delegates = result.data.delegates;
        formatter.output(delegates, () => {
          if (delegates.length === 0) {
            return "No child delegates found.";
          }

          const header = `${"ID".padEnd(32)}  ${"NAME".padEnd(16)}  DEPTH  UPLOAD  MANAGE  STATUS    CREATED`;
          const lines = delegates.map((d) => {
            const name = (d.name || "—").slice(0, 14).padEnd(16);
            const depth = String(d.depth).padEnd(5);
            const upload = (d.canUpload ? "yes" : "no").padEnd(6);
            const manage = (d.canManageDepot ? "yes" : "no").padEnd(6);
            const status = (d.isRevoked ? "revoked" : "active").padEnd(8);
            const created = formatRelativeTime(d.createdAt);
            return `${d.delegateId.slice(0, 30).padEnd(32)}  ${name}  ${depth}  ${upload}  ${manage}  ${status}  ${created}`;
          });

          return [header, ...lines].join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  // ── delegate show ─────────────────────────────────────────────────────────
  delegate
    .command("show <delegate-id>")
    .description("Show delegate details")
    .action(async (delegateId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.delegates.get(delegateId);
        if (!result.ok) {
          formatter.error(`Failed to get delegate: ${result.error.message}`);
          process.exit(1);
        }

        const d = result.data;
        formatter.output(d, () => {
          const lines = [
            `ID:             ${d.delegateId}`,
            `Name:           ${d.name || "(none)"}`,
            `Realm:          ${d.realm}`,
            `Parent ID:      ${d.parentId || "(root)"}`,
            `Depth:          ${d.depth}`,
            `Chain:          ${d.chain.join(" → ")}`,
            `Can Upload:     ${d.canUpload ? "yes" : "no"}`,
            `Can Manage:     ${d.canManageDepot ? "yes" : "no"}`,
            `Status:         ${d.isRevoked ? "revoked" : "active"}`,
            `Created:        ${new Date(d.createdAt).toISOString()}`,
          ];

          if (d.expiresAt) {
            lines.push(`Expires:        ${new Date(d.expiresAt).toISOString()}`);
          }
          if (d.isRevoked && d.revokedAt) {
            lines.push(`Revoked At:     ${new Date(d.revokedAt).toISOString()}`);
            if (d.revokedBy) {
              lines.push(`Revoked By:     ${d.revokedBy}`);
            }
          }

          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  // ── delegate revoke ───────────────────────────────────────────────────────
  delegate
    .command("revoke <delegate-id>")
    .description("Revoke a child delegate")
    .action(async (delegateId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealmAuth(resolved);

        const result = await resolved.client.delegates.revoke(delegateId);
        if (!result.ok) {
          formatter.error(`Failed to revoke delegate: ${result.error.message}`);
          process.exit(1);
        }

        formatter.output(result.data, () => {
          return `Revoked delegate: ${delegateId}`;
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
