import { api } from "@casfa/client";
import type { Command } from "commander";
import { createClient, requireAuth, requireRealm } from "../lib/client";
import { createFormatter, formatSize } from "../lib/output";

/**
 * Ensure we have an access token for realm operations.
 */
async function ensureAccessToken(
  resolved: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  const state = resolved.client.getState();

  if (state.access) {
    return state.access.tokenBase64;
  }

  if (state.delegate) {
    const result = await api.delegateToken(
      resolved.baseUrl,
      state.delegate.tokenBase64,
      { name: "cli-realm-info", type: "access", expiresIn: 300, canUpload: false, canManageDepot: false }
    );
    if (!result.ok) {
      throw new Error(`Failed to get access token: ${result.error.message}`);
    }
    return result.data.token;
  }

  if (state.user) {
    const result = await api.createToken(resolved.baseUrl, state.user.accessToken, {
      realm: resolved.realm,
      name: "cli-realm-info",
      type: "access",
      expiresIn: 300,
      canUpload: false,
      canManageDepot: false,
    });
    if (!result.ok) {
      throw new Error(`Failed to get access token: ${result.error.message}`);
    }
    return result.data.token;
  }

  throw new Error("Authentication required.");
}

/**
 * Fetch realm info from API.
 */
async function fetchRealmInfo(
  baseUrl: string,
  realm: string,
  accessToken: string
): Promise<{ realm: string; nodeLimit: number; maxNameBytes: number }> {
  const response = await fetch(`${baseUrl}/api/realm/${encodeURIComponent(realm)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error((error as { message?: string }).message ?? response.statusText);
  }

  return response.json() as Promise<{ realm: string; nodeLimit: number; maxNameBytes: number }>;
}

/**
 * Fetch realm usage from API.
 */
async function fetchRealmUsage(
  baseUrl: string,
  realm: string,
  accessToken: string
): Promise<{
  realm: string;
  physicalBytes: number;
  logicalBytes: number;
  nodeCount: number;
  quotaLimit: number;
  updatedAt: number;
}> {
  const response = await fetch(`${baseUrl}/api/realm/${encodeURIComponent(realm)}/usage`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error((error as { message?: string }).message ?? response.statusText);
  }

  return response.json() as Promise<{
    realm: string;
    physicalBytes: number;
    logicalBytes: number;
    nodeCount: number;
    quotaLimit: number;
    updatedAt: number;
  }>;
}

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
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved);
        const info = await fetchRealmInfo(resolved.baseUrl, resolved.realm, accessToken);

        formatter.output(info, () => {
          const lines = [
            `Realm ID:       ${info.realm}`,
            `Node Limit:     ${formatSize(info.nodeLimit)}`,
            `Max Name Bytes: ${info.maxNameBytes}`,
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
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved);
        const usage = await fetchRealmUsage(resolved.baseUrl, resolved.realm, accessToken);

        formatter.output(usage, () => {
          const lines = [
            `Realm ID:       ${usage.realm}`,
            `Node Count:     ${usage.nodeCount.toLocaleString()}`,
            `Physical Size:  ${formatSize(usage.physicalBytes)}`,
            `Logical Size:   ${formatSize(usage.logicalBytes)}`,
            `Quota Limit:    ${usage.quotaLimit ? formatSize(usage.quotaLimit) : "Unlimited"}`,
            `Updated At:     ${new Date(usage.updatedAt).toISOString()}`,
          ];
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}
