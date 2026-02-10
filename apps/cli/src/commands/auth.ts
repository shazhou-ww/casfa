import { api } from "@casfa/client";
import type { Command } from "commander";
import { createClient, requireUserAuth } from "../lib/client";
import { getProfile, loadConfig, saveConfig } from "../lib/config";
import {
  clearRootDelegate,
  clearUserToken,
  deleteCredentials,
  formatExpiresIn,
  getAuthType,
  getCredentials,
  getExpirationInfo,
  setRootDelegate,
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
        const result = await oauthLogin({
          baseUrl: profile.baseUrl,
          profileName,
        });

        // After successful OAuth login, auto-set realm and acquire root delegate
        if (result.success && result.userId) {
          // realm === userId; auto-save to profile so subsequent commands work
          if (!profile.realm) {
            profile.realm = result.userId;
            saveConfig(config);
            formatter.info(`Realm set to ${result.userId}`);
          }

          const realm = profile.realm;
          formatter.info("Acquiring root delegate...");
          try {
            const cred = getCredentials(profileName);
            if (cred?.userToken) {
              const rootResult = await api.createRootToken(
                profile.baseUrl,
                cred.userToken.accessToken,
                realm
              );

              if (rootResult.ok) {
                const rd = rootResult.data;
                setRootDelegate(profileName, {
                  delegateId: rd.delegate.delegateId,
                  realm: rd.delegate.realm,
                  refreshToken: rd.refreshToken,
                  refreshTokenId: rd.refreshTokenId,
                  accessToken: rd.accessToken,
                  accessTokenId: rd.accessTokenId,
                  accessTokenExpiresAt: Math.floor(rd.accessTokenExpiresAt / 1000),
                  depth: rd.delegate.depth,
                  canUpload: rd.delegate.canUpload,
                  canManageDepot: rd.delegate.canManageDepot,
                });
                formatter.success("Root delegate acquired");
              } else {
                formatter.warn(
                  `Could not acquire root delegate: ${rootResult.error.message}. ` +
                    "You may need to run 'casfa auth init-delegate' manually."
                );
              }
            }
          } catch (error) {
            formatter.warn(
              `Could not acquire root delegate: ${(error as Error).message}. ` +
                "You may need to run 'casfa auth init-delegate' manually."
            );
          }
        }

        formatter.info(`Credentials saved to profile: ${profileName}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Clear stored credentials")
    .option("--user-only", "Only clear user token, keep root delegate")
    .option("--delegate-only", "Only clear root delegate, keep user token")
    .action((cmdOpts: { userOnly?: boolean; delegateOnly?: boolean }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      const profileName = opts.profile || config.currentProfile;

      if (cmdOpts.userOnly) {
        clearUserToken(profileName);
        formatter.success(`User token cleared for profile: ${profileName}`);
      } else if (cmdOpts.delegateOnly) {
        clearRootDelegate(profileName);
        formatter.success(`Root delegate cleared for profile: ${profileName}`);
      } else {
        deleteCredentials(profileName);
        formatter.success(`Logged out from profile: ${profileName}`);
      }
    });

  // ========================================================================
  // Init Delegate (manual root delegate acquisition)
  // ========================================================================

  auth
    .command("init-delegate")
    .description("Acquire root delegate for current realm (requires login)")
    .action(async () => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const config = loadConfig();
        const profileName = opts.profile || config.currentProfile;
        const profile = getProfile(config, profileName);
        const baseUrl = opts.baseUrl || profile.baseUrl;
        const realm = opts.realm || profile.realm;

        if (!realm) {
          formatter.error(
            "Realm is required. Set via --realm option or 'casfa config set realm <id>'."
          );
          process.exit(1);
        }

        const cred = getCredentials(profileName);
        if (!cred?.userToken) {
          formatter.error("User token not found. Run 'casfa auth login' first.");
          process.exit(1);
        }

        const rootResult = await api.createRootToken(baseUrl, cred.userToken.accessToken, realm);

        if (!rootResult.ok) {
          formatter.error(`Failed to acquire root delegate: ${rootResult.error.message}`);
          process.exit(1);
        }

        const rd = rootResult.data;
        setRootDelegate(profileName, {
          delegateId: rd.delegate.delegateId,
          realm: rd.delegate.realm,
          refreshToken: rd.refreshToken,
          refreshTokenId: rd.refreshTokenId,
          accessToken: rd.accessToken,
          accessTokenId: rd.accessTokenId,
          accessTokenExpiresAt: Math.floor(rd.accessTokenExpiresAt / 1000),
          depth: rd.delegate.depth,
          canUpload: rd.delegate.canUpload,
          canManageDepot: rd.delegate.canManageDepot,
        });

        formatter.success("Root delegate acquired");
        formatter.output(
          {
            delegateId: rd.delegate.delegateId,
            realm: rd.delegate.realm,
            canUpload: rd.delegate.canUpload,
            canManageDepot: rd.delegate.canManageDepot,
          },
          () => {
            return [
              `Delegate ID:    ${rd.delegate.delegateId}`,
              `Realm:          ${rd.delegate.realm}`,
              `Can Upload:     ${rd.delegate.canUpload ? "yes" : "no"}`,
              `Can Manage:     ${rd.delegate.canManageDepot ? "yes" : "no"}`,
            ].join("\n");
          }
        );
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
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
      const _expInfo = getExpirationInfo(credentials);

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
        rootDelegate: credentials.rootDelegate
          ? {
              delegateId: credentials.rootDelegate.delegateId,
              realm: credentials.rootDelegate.realm,
              accessTokenExpiresIn: formatExpiresIn(credentials.rootDelegate.accessTokenExpiresAt),
              canUpload: credentials.rootDelegate.canUpload,
              canManageDepot: credentials.rootDelegate.canManageDepot,
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

        if (status.rootDelegate) {
          lines.push("");
          lines.push("Root Delegate:");
          lines.push(`  Delegate:  ${status.rootDelegate.delegateId}`);
          lines.push(`  Realm:     ${status.rootDelegate.realm}`);
          lines.push(`  AT Expiry: ${status.rootDelegate.accessTokenExpiresIn}`);
          lines.push(`  Upload:    ${status.rootDelegate.canUpload ? "yes" : "no"}`);
          lines.push(`  Manage:    ${status.rootDelegate.canManageDepot ? "yes" : "no"}`);
        }

        return lines.join("\n");
      });
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

          const result = await api.createAuthRequest(
            baseUrl,
            params as Parameters<typeof api.createAuthRequest>[1]
          );

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
              `Or use: casfa auth request approve ${requestId}`,
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
                formatter.info("Use 'casfa auth login' to authenticate with the service.");
                return;
              }

              if (status === "rejected") {
                formatter.error(`\nRequest rejected${reason ? `: ${reason}` : ""}`);
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
