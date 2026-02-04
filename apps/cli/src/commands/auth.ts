import { createCasfaClient } from "@casfa/client";
import type { Command } from "commander";
import { createClient, requireUserAuth } from "../lib/client";
import { loadConfig } from "../lib/config";
import {
  deleteCredentials,
  formatExpiresIn,
  getCredentials,
  getCredentialsPath,
  setCredentials,
} from "../lib/credentials";
import { oauthLogin } from "../lib/oauth-login";
import { createFormatter } from "../lib/output";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Authentication management");

  auth
    .command("login")
    .description("Login via browser (OAuth 2.0 PKCE flow)")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;
      const profile = config.profiles[profileName];

      if (!profile) {
        formatter.error(`Profile "${profileName}" not found. Run 'casfa config init' first.`);
        process.exit(1);
      }

      const baseClient = createCasfaClient({ baseUrl: profile.baseUrl });

      try {
        await oauthLogin({
          client: baseClient,
          profileName,
        });

        formatter.info(`Credentials saved to ${getCredentialsPath()}`);
      } catch (error) {
        formatter.error((error as Error).message);
        formatter.info(
          "Alternative: Use 'casfa auth token set <token>' to set an agent token directly."
        );
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      deleteCredentials(profileName);
      formatter.success(`Logged out from profile: ${profileName}`);
    });

  auth
    .command("whoami")
    .description("Show current user information")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        // Get the underlying user client
        const userClient = resolved.type === "user" ? resolved.client : resolved.client.client;
        const result = await userClient.getMe();

        if (!result.ok) {
          formatter.error(`Failed to get user info: ${result.error.message}`);
          process.exit(1);
        }

        const userInfo = result.data;
        formatter.output(userInfo, () => {
          const lines = [
            `User ID:  ${userInfo.userId}`,
            `Name:     ${userInfo.name ?? "(not set)"}`,
            `Email:    ${userInfo.email ?? "(not set)"}`,
            `Role:     ${userInfo.role}`,
          ];
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  auth
    .command("status")
    .description("Check authentication status")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;
      const credentials = getCredentials(profileName);

      if (!credentials) {
        formatter.output(
          { authenticated: false, profile: profileName },
          () => `Not authenticated for profile: ${profileName}`
        );
        return;
      }

      const status = {
        profile: profileName,
        authenticated: true,
        type: credentials.type,
        expiresIn: formatExpiresIn(credentials),
      };

      formatter.output(status, () => {
        const lines = [
          `Profile:     ${status.profile}`,
          `Auth Type:   ${status.type}`,
          `Expires In:  ${status.expiresIn}`,
        ];
        return lines.join("\n");
      });
    });

  // Token subcommands
  const token = auth.command("token").description("Agent token management");

  token
    .command("create")
    .description("Create a new agent token")
    .requiredOption("-n, --name <name>", "token name/description")
    .option("-t, --ttl <seconds>", "token TTL in seconds", "2592000")
    .action(async (cmdOpts: { name: string; ttl: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const userClient = resolved.type === "user" ? resolved.client : resolved.client.client;
        const result = await userClient.agentTokens.create({
          name: cmdOpts.name,
          expiresIn: parseInt(cmdOpts.ttl, 10),
        });

        if (!result.ok) {
          formatter.error(`Failed to create token: ${result.error.message}`);
          process.exit(1);
        }

        const tokenInfo = result.data;
        formatter.output(tokenInfo, () => {
          const lines = [
            `Token ID:  ${tokenInfo.tokenId}`,
            `Token:     ${tokenInfo.token}`,
            "",
            "⚠ Save this token securely. It will not be shown again.",
          ];
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  token
    .command("list")
    .alias("ls")
    .description("List agent tokens")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const userClient = resolved.type === "user" ? resolved.client : resolved.client.client;
        const result = await userClient.agentTokens.list();

        if (!result.ok) {
          formatter.error(`Failed to list tokens: ${result.error.message}`);
          process.exit(1);
        }

        const tokens = result.data.items;
        formatter.output(tokens, () => {
          if (tokens.length === 0) {
            return "No agent tokens found.";
          }
          return tokens
            .map(
              (t: { tokenId: string; name: string; createdAt: number }) =>
                `${t.tokenId}  ${t.name || "(unnamed)"}  ${t.createdAt}`
            )
            .join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  token
    .command("revoke <token-id>")
    .description("Revoke an agent token")
    .action(async (tokenId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const userClient = resolved.type === "user" ? resolved.client : resolved.client.client;
        const result = await userClient.agentTokens.revoke({ tokenId });

        if (!result.ok) {
          formatter.error(`Failed to revoke token: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Token ${tokenId} revoked`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  token
    .command("set <token>")
    .description("Set an agent token for the current profile")
    .action((tokenValue: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      setCredentials(profileName, {
        type: "token",
        token: tokenValue,
      });

      formatter.success(`Agent token saved for profile: ${profileName}`);
    });

  // Set JWT token directly (for mock auth / development)
  auth
    .command("set-jwt <token>")
    .description("Set a JWT token directly (for mock auth / development)")
    .action((tokenValue: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      // Parse JWT to get expiry
      let expiresAt = Math.floor(Date.now() / 1000) + 3600; // default 1 hour
      try {
        const parts = tokenValue.split(".");
        if (parts.length === 3 && parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
          if (payload.exp) {
            expiresAt = payload.exp;
          }
        }
      } catch {
        // ignore parsing errors
      }

      setCredentials(profileName, {
        type: "oauth",
        accessToken: tokenValue,
        refreshToken: "",
        expiresAt,
      });

      formatter.success(`JWT token saved for profile: ${profileName}`);
      formatter.info(`Expires: ${new Date(expiresAt * 1000).toISOString()}`);
    });
}
