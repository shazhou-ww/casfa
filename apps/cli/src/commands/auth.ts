import { api } from "@casfa/client";
import type { Command } from "commander";
import { createClient, requireUserAuth } from "../lib/client";
import { loadConfig, getProfile } from "../lib/config";
import {
  clearDelegateToken,
  clearUserToken,
  deleteCredentials,
  formatExpiresIn,
  getAuthType,
  getCredentials,
  getCredentialsPath,
  getExpirationInfo,
  setDelegateToken,
  setUserToken,
} from "../lib/credentials";
import { oauthLogin } from "../lib/oauth-login";
import { createFormatter } from "../lib/output";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Authentication management");

  // ========================================================================
  // Login / Logout
  // ========================================================================

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

      try {
        await oauthLogin({
          baseUrl: profile.baseUrl,
          profileName,
        });

        formatter.info(`Credentials saved to ${getCredentialsPath()}`);
      } catch (error) {
        formatter.error((error as Error).message);
        formatter.info(
          "Alternative: Use 'casfa auth delegate set <token>' to set a delegate token directly."
        );
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Clear stored credentials")
    .option("--user-only", "Only clear user token, keep delegate token")
    .option("--delegate-only", "Only clear delegate token, keep user token")
    .action((cmdOpts: { userOnly?: boolean; delegateOnly?: boolean }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      if (cmdOpts.userOnly) {
        clearUserToken(profileName);
        formatter.success(`User token cleared for profile: ${profileName}`);
      } else if (cmdOpts.delegateOnly) {
        clearDelegateToken(profileName);
        formatter.success(`Delegate token cleared for profile: ${profileName}`);
      } else {
        deleteCredentials(profileName);
        formatter.success(`Logged out from profile: ${profileName}`);
      }
    });

  // ========================================================================
  // User Info
  // ========================================================================

  auth
    .command("whoami")
    .description("Show current user information")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const state = resolved.client.getState();
        if (!state.user) {
          formatter.error("No user token found. Run 'casfa auth login' first.");
          process.exit(1);
        }

        const result = await api.getMe(resolved.baseUrl, state.user.accessToken);

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

      const authType = getAuthType(credentials);
      const expInfo = getExpirationInfo(credentials);

      const status = {
        profile: profileName,
        authenticated: authType !== "none",
        authType,
        userToken: credentials.userToken
          ? {
              expiresIn: formatExpiresIn(credentials.userToken.expiresAt),
              userId: credentials.userToken.userId,
            }
          : null,
        delegateToken: credentials.delegateToken
          ? {
              tokenId: credentials.delegateToken.tokenId,
              expiresIn: formatExpiresIn(credentials.delegateToken.expiresAt),
              realm: credentials.delegateToken.realm,
            }
          : null,
      };

      formatter.output(status, () => {
        const lines = [`Profile:     ${status.profile}`, `Auth Type:   ${status.authType}`];

        if (status.userToken) {
          lines.push("");
          lines.push("User Token:");
          lines.push(`  User ID:   ${status.userToken.userId || "(unknown)"}`);
          lines.push(`  Expires:   ${status.userToken.expiresIn}`);
        }

        if (status.delegateToken) {
          lines.push("");
          lines.push("Delegate Token:");
          lines.push(`  Token ID:  ${status.delegateToken.tokenId}`);
          lines.push(`  Expires:   ${status.delegateToken.expiresIn}`);
          if (status.delegateToken.realm) {
            lines.push(`  Realm:     ${status.delegateToken.realm}`);
          }
        }

        return lines.join("\n");
      });
    });

  // ========================================================================
  // Token Management
  // ========================================================================

  const token = auth.command("token").description("Token management");

  token
    .command("create")
    .description("Create a new Delegate or Access Token")
    .requiredOption("-n, --name <name>", "token name/description")
    .requiredOption("--type <type>", "token type: delegate or access", "delegate")
    .option("-t, --ttl <seconds>", "token TTL in seconds", "2592000")
    .option("--can-upload", "allow upload operations", true)
    .option("--no-can-upload", "disallow upload operations")
    .option("--can-manage-depot", "allow depot management", true)
    .option("--no-can-manage-depot", "disallow depot management")
    .option("--scope <paths>", "scope paths (comma-separated)")
    .action(
      async (cmdOpts: {
        name: string;
        type: string;
        ttl: string;
        canUpload: boolean;
        canManageDepot: boolean;
        scope?: string;
      }) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        try {
          const resolved = await createClient(opts);
          requireUserAuth(resolved);

          const state = resolved.client.getState();
          if (!state.user) {
            formatter.error("User authentication required. Run 'casfa auth login'.");
            process.exit(1);
          }

          const tokenType = cmdOpts.type as "delegate" | "access";
          if (tokenType !== "delegate" && tokenType !== "access") {
            formatter.error("Token type must be 'delegate' or 'access'");
            process.exit(1);
          }

          const params = {
            realm: resolved.realm,
            name: cmdOpts.name,
            type: tokenType,
            expiresIn: parseInt(cmdOpts.ttl, 10),
            canUpload: cmdOpts.canUpload,
            canManageDepot: cmdOpts.canManageDepot,
            scope: cmdOpts.scope ? cmdOpts.scope.split(",").map((s) => s.trim()) : undefined,
          };

          const result = await api.createToken(resolved.baseUrl, state.user.accessToken, params);

          if (!result.ok) {
            formatter.error(`Failed to create token: ${result.error.message}`);
            process.exit(1);
          }

          const tokenInfo = result.data;
          formatter.output(tokenInfo, () => {
            const lines = [
              `Token ID:    ${tokenInfo.tokenId}`,
              `Type:        ${tokenType}`,
              `Token:       ${tokenInfo.token}`,
              "",
              "Save this token securely. It will not be shown again.",
            ];
            return lines.join("\n");
          });
        } catch (error) {
          formatter.error((error as Error).message);
          process.exit(1);
        }
      }
    );

  token
    .command("list")
    .alias("ls")
    .description("List tokens")
    .option("--type <type>", "filter by type: delegate or access")
    .action(async (cmdOpts: { type?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const state = resolved.client.getState();
        if (!state.user) {
          formatter.error("User authentication required. Run 'casfa auth login'.");
          process.exit(1);
        }

        const params: api.ListTokensParams = {};
        if (cmdOpts.type === "delegate" || cmdOpts.type === "access") {
          params.type = cmdOpts.type;
        }

        const result = await api.listTokens(resolved.baseUrl, state.user.accessToken, params);

        if (!result.ok) {
          formatter.error(`Failed to list tokens: ${result.error.message}`);
          process.exit(1);
        }

        const tokens = result.data.tokens;
        formatter.output(tokens, () => {
          if (tokens.length === 0) {
            return "No tokens found.";
          }

          const header = `${"TYPE".padEnd(10)} ${"ID".padEnd(28)} ${"NAME".padEnd(20)} EXPIRES`;
          const lines = tokens.map((t) => {
            const type = t.type.padEnd(10);
            const id = t.tokenId.slice(0, 26).padEnd(28);
            const name = (t.name || "(unnamed)").slice(0, 18).padEnd(20);
            const expires = t.expiresAt ? formatExpiresIn(t.expiresAt) : "N/A";
            return `${type} ${id} ${name} ${expires}`;
          });

          return [header, ...lines].join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  token
    .command("show <token-id>")
    .description("Show token details")
    .action(async (tokenId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const state = resolved.client.getState();
        if (!state.user) {
          formatter.error("User authentication required. Run 'casfa auth login'.");
          process.exit(1);
        }

        const result = await api.getToken(resolved.baseUrl, state.user.accessToken, tokenId);

        if (!result.ok) {
          formatter.error(`Failed to get token: ${result.error.message}`);
          process.exit(1);
        }

        const t = result.data;
        formatter.output(t, () => {
          const lines = [
            `Token ID:        ${t.tokenId}`,
            `Type:            ${t.type}`,
            `Name:            ${t.name || "(unnamed)"}`,
            `Realm:           ${t.realm}`,
            `Issuer:          ${t.issuerId}`,
            `Can Upload:      ${t.canUpload ? "yes" : "no"}`,
            `Can Manage Depot:${t.canManageDepot ? "yes" : "no"}`,
            `Created:         ${new Date(t.createdAt * 1000).toISOString()}`,
            `Expires:         ${t.expiresAt ? new Date(t.expiresAt * 1000).toISOString() : "N/A"}`,
          ];

          if (t.scope && t.scope.length > 0) {
            lines.push(`Scope:           ${t.scope.join(", ")}`);
          }

          if (t.isRevoked) {
            lines.push(`Status:          REVOKED`);
          }

          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  token
    .command("revoke <token-id>")
    .description("Revoke a token")
    .action(async (tokenId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const state = resolved.client.getState();
        if (!state.user) {
          formatter.error("User authentication required. Run 'casfa auth login'.");
          process.exit(1);
        }

        const result = await api.revokeToken(resolved.baseUrl, state.user.accessToken, tokenId);

        if (!result.ok) {
          formatter.error(`Failed to revoke token: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Token ${tokenId} revoked`);
        if (result.data.childrenRevoked && result.data.childrenRevoked > 0) {
          formatter.info(`Also revoked ${result.data.childrenRevoked} child token(s)`);
        }
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  token
    .command("delegate")
    .description("Re-issue a token using current Delegate Token")
    .requiredOption("-n, --name <name>", "token name/description")
    .requiredOption("--type <type>", "token type: delegate or access")
    .option("-t, --ttl <seconds>", "token TTL in seconds", "86400")
    .option("--can-upload", "allow upload operations", true)
    .option("--no-can-upload", "disallow upload operations")
    .option("--can-manage-depot", "allow depot management", true)
    .option("--no-can-manage-depot", "disallow depot management")
    .option("--scope <paths>", "relative scope paths (comma-separated)")
    .action(
      async (cmdOpts: {
        name: string;
        type: string;
        ttl: string;
        canUpload: boolean;
        canManageDepot: boolean;
        scope?: string;
      }) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        try {
          const resolved = await createClient(opts);

          const state = resolved.client.getState();
          if (!state.delegate) {
            formatter.error(
              "Delegate token required. Set via 'casfa auth delegate set' or --delegate-token option."
            );
            process.exit(1);
          }

          const tokenType = cmdOpts.type as "delegate" | "access";
          if (tokenType !== "delegate" && tokenType !== "access") {
            formatter.error("Token type must be 'delegate' or 'access'");
            process.exit(1);
          }

          const params: api.DelegateTokenParams = {
            name: cmdOpts.name,
            type: tokenType,
            expiresIn: parseInt(cmdOpts.ttl, 10),
            canUpload: cmdOpts.canUpload,
            canManageDepot: cmdOpts.canManageDepot,
            scope: cmdOpts.scope ? cmdOpts.scope.split(",").map((s) => s.trim()) : undefined,
          };

          const result = await api.delegateToken(
            resolved.baseUrl,
            state.delegate.tokenBase64,
            params
          );

          if (!result.ok) {
            formatter.error(`Failed to delegate token: ${result.error.message}`);
            process.exit(1);
          }

          const tokenInfo = result.data;
          formatter.output(tokenInfo, () => {
            const lines = [
              `Token ID:    ${tokenInfo.tokenId}`,
              `Type:        ${tokenType}`,
              `Token:       ${tokenInfo.token}`,
              "",
              "Save this token securely. It will not be shown again.",
            ];
            return lines.join("\n");
          });
        } catch (error) {
          formatter.error((error as Error).message);
          process.exit(1);
        }
      }
    );

  // ========================================================================
  // Delegate Token Management
  // ========================================================================

  const delegate = auth.command("delegate").description("Delegate token management");

  delegate
    .command("set <token>")
    .description("Set a delegate token for the current profile")
    .option("--token-id <id>", "token ID (optional)")
    .action((tokenValue: string, cmdOpts: { tokenId?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;
      const profile = getProfile(config, profileName);

      setDelegateToken(profileName, {
        tokenId: cmdOpts.tokenId || "cli-imported",
        token: tokenValue,
        realm: profile.realm,
      });

      formatter.success(`Delegate token saved for profile: ${profileName}`);
    });

  delegate
    .command("clear")
    .description("Clear the delegate token for the current profile")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      clearDelegateToken(profileName);
      formatter.success(`Delegate token cleared for profile: ${profileName}`);
    });

  // ========================================================================
  // Client Authorization Request (Device Flow)
  // ========================================================================

  const request = auth.command("request").description("Request authorization (device flow)");

  request
    .command("create")
    .description("Create a new authorization request")
    .option("-n, --name <name>", "request name/description")
    .option("--type <type>", "requested token type: delegate or access", "access")
    .option("-t, --ttl <seconds>", "requested token TTL in seconds")
    .option("--can-upload", "request upload permission")
    .option("--can-manage-depot", "request depot management permission")
    .option("--scope <pattern>", "requested scope pattern")
    .option("-w, --wait", "wait for approval (poll until approved/denied)")
    .option("--poll-interval <ms>", "poll interval in milliseconds", "3000")
    .option("--timeout <seconds>", "timeout in seconds", "300")
    .action(
      async (cmdOpts: {
        name?: string;
        type?: string;
        ttl?: string;
        canUpload?: boolean;
        canManageDepot?: boolean;
        scope?: string;
        wait?: boolean;
        pollInterval?: string;
        timeout?: string;
      }) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        const config = loadConfig();
        const profileName = opts.profile || config.currentProfile;
        const profile = getProfile(config, profileName);
        const baseUrl = opts.baseUrl || profile.baseUrl;
        const realm = opts.realm || profile.realm;

        if (!realm) {
          formatter.error(
            "Realm is required. Set via --realm option, CASFA_REALM env var, or 'casfa config set realm <id>'."
          );
          process.exit(1);
        }

        try {
          const params: {
            realm: string;
            name?: string;
            type?: "delegate" | "access";
            expiresIn?: number;
            canUpload?: boolean;
            canManageDepot?: boolean;
            scope?: string;
          } = { realm };

          if (cmdOpts.name) params.name = cmdOpts.name;
          if (cmdOpts.type === "delegate" || cmdOpts.type === "access") {
            params.type = cmdOpts.type;
          }
          if (cmdOpts.ttl) params.expiresIn = parseInt(cmdOpts.ttl, 10);
          if (cmdOpts.canUpload) params.canUpload = true;
          if (cmdOpts.canManageDepot) params.canManageDepot = true;
          if (cmdOpts.scope) params.scope = cmdOpts.scope;

          const result = await api.createAuthRequest(baseUrl, params);

          if (!result.ok) {
            formatter.error(`Failed to create request: ${result.error.message}`);
            process.exit(1);
          }

          const { requestId, authUrl, expiresAt } = result.data;

          formatter.output(result.data, () => {
            const lines = [
              `Request ID:  ${requestId}`,
              `Expires At:  ${new Date(expiresAt * 1000).toISOString()}`,
              "",
              "Open this URL to approve the request:",
              authUrl,
              "",
              "Or use: casfa auth request approve " + requestId,
            ];
            return lines.join("\n");
          });

          // If --wait, poll until approved/denied
          if (cmdOpts.wait) {
            const pollInterval = parseInt(cmdOpts.pollInterval || "3000", 10);
            const timeout = parseInt(cmdOpts.timeout || "300", 10) * 1000;
            const startTime = Date.now();

            formatter.info("\nWaiting for approval...");

            while (Date.now() - startTime < timeout) {
              await new Promise((resolve) => setTimeout(resolve, pollInterval));

              const pollResult = await api.pollAuthRequest(baseUrl, requestId);
              if (!pollResult.ok) {
                formatter.error(`Poll failed: ${pollResult.error.message}`);
                process.exit(1);
              }

              const { status, tokenBase64, reason } = pollResult.data;

              if (status === "approved" && tokenBase64) {
                formatter.success("\nRequest approved!");
                formatter.output({ token: tokenBase64 }, () => `Token: ${tokenBase64}`);

                // Save as delegate token
                setDelegateToken(profileName, {
                  tokenId: requestId,
                  token: tokenBase64,
                  realm,
                });
                formatter.info(`Token saved to profile: ${profileName}`);
                return;
              }

              if (status === "denied") {
                formatter.error(`\nRequest denied${reason ? `: ${reason}` : ""}`);
                process.exit(1);
              }

              if (status === "expired") {
                formatter.error("\nRequest expired");
                process.exit(1);
              }

              // Still pending, continue polling
              process.stdout.write(".");
            }

            formatter.error("\nTimeout waiting for approval");
            process.exit(1);
          }
        } catch (error) {
          formatter.error((error as Error).message);
          process.exit(1);
        }
      }
    );

  request
    .command("poll <request-id>")
    .description("Poll authorization request status")
    .action(async (requestId: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;
      const profile = getProfile(config, profileName);
      const baseUrl = opts.baseUrl || profile.baseUrl;

      try {
        const result = await api.pollAuthRequest(baseUrl, requestId);

        if (!result.ok) {
          formatter.error(`Failed to poll request: ${result.error.message}`);
          process.exit(1);
        }

        formatter.output(result.data, () => {
          const { status, tokenBase64, reason } = result.data;
          const lines = [`Request ID: ${requestId}`, `Status:     ${status}`];

          if (tokenBase64) {
            lines.push(`Token:      ${tokenBase64}`);
          }
          if (reason) {
            lines.push(`Reason:     ${reason}`);
          }

          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  auth
    .command("approve <request-id>")
    .description("Approve an authorization request")
    .option("--type <type>", "override token type: delegate or access")
    .option("-t, --ttl <seconds>", "override token TTL in seconds")
    .option("--can-upload", "grant upload permission")
    .option("--no-can-upload", "deny upload permission")
    .option("--can-manage-depot", "grant depot management permission")
    .option("--no-can-manage-depot", "deny depot management permission")
    .option("--scope <pattern>", "override scope pattern")
    .action(
      async (
        requestId: string,
        cmdOpts: {
          type?: string;
          ttl?: string;
          canUpload?: boolean;
          canManageDepot?: boolean;
          scope?: string;
        }
      ) => {
        const opts = program.opts();
        const formatter = createFormatter(opts);

        try {
          const resolved = await createClient(opts);
          requireUserAuth(resolved);

          const state = resolved.client.getState();
          if (!state.user) {
            formatter.error("User authentication required. Run 'casfa auth login'.");
            process.exit(1);
          }

          const params: {
            type?: "delegate" | "access";
            expiresIn?: number;
            canUpload?: boolean;
            canManageDepot?: boolean;
            scope?: string;
          } = {};

          if (cmdOpts.type === "delegate" || cmdOpts.type === "access") {
            params.type = cmdOpts.type;
          }
          if (cmdOpts.ttl) params.expiresIn = parseInt(cmdOpts.ttl, 10);
          if (cmdOpts.canUpload !== undefined) params.canUpload = cmdOpts.canUpload;
          if (cmdOpts.canManageDepot !== undefined) params.canManageDepot = cmdOpts.canManageDepot;
          if (cmdOpts.scope) params.scope = cmdOpts.scope;

          const result = await api.approveAuthRequest(
            resolved.baseUrl,
            state.user.accessToken,
            requestId,
            params
          );

          if (!result.ok) {
            formatter.error(`Failed to approve request: ${result.error.message}`);
            process.exit(1);
          }

          formatter.success(`Request ${requestId} approved`);
          formatter.info(`Token ID: ${result.data.tokenId}`);
        } catch (error) {
          formatter.error((error as Error).message);
          process.exit(1);
        }
      }
    );

  auth
    .command("reject <request-id>")
    .description("Reject an authorization request")
    .option("-r, --reason <reason>", "rejection reason")
    .action(async (requestId: string, cmdOpts: { reason?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireUserAuth(resolved);

        const state = resolved.client.getState();
        if (!state.user) {
          formatter.error("User authentication required. Run 'casfa auth login'.");
          process.exit(1);
        }

        const params: { reason?: string } = {};
        if (cmdOpts.reason) params.reason = cmdOpts.reason;

        const result = await api.rejectAuthRequest(
          resolved.baseUrl,
          state.user.accessToken,
          requestId,
          params
        );

        if (!result.ok) {
          formatter.error(`Failed to reject request: ${result.error.message}`);
          process.exit(1);
        }

        formatter.success(`Request ${requestId} rejected`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  // ========================================================================
  // Development / Debug Commands
  // ========================================================================

  auth
    .command("set-jwt <token>")
    .description("Set a JWT token directly (for development/testing)")
    .action((tokenValue: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      // Parse JWT to get expiry and user ID
      let expiresAt = Math.floor(Date.now() / 1000) + 3600; // default 1 hour
      let userId: string | undefined;

      try {
        const parts = tokenValue.split(".");
        if (parts.length === 3 && parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
          if (payload.exp) {
            expiresAt = payload.exp;
          }
          if (payload.sub) {
            userId = payload.sub;
          }
        }
      } catch {
        // ignore parsing errors
      }

      setUserToken(profileName, {
        accessToken: tokenValue,
        refreshToken: "",
        userId,
        expiresAt,
      });

      formatter.success(`JWT token saved for profile: ${profileName}`);
      formatter.info(`Expires: ${new Date(expiresAt * 1000).toISOString()}`);
    });
}
