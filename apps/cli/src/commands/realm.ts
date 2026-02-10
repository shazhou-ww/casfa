import type { Command } from "commander";
import { createClient, requireRealmAuth } from "../lib/client";
import { createFormatter, formatSize } from "../lib/output";

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
        requireRealmAuth(resolved);

        const accessToken = await getAccessTokenBase64(resolved);
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
        requireRealmAuth(resolved);

        const accessToken = await getAccessTokenBase64(resolved);
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
