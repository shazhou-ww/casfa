import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { loadOtaviaYaml } from "../config/load-otavia-yaml.js";
import { loadCellConfig } from "../config/load-cell-yaml.js";
import { resolveCellDir } from "../config/resolve-cell-dir.js";
import { assertDeclaredParamsProvided, mergeParams, resolveParams } from "../config/resolve-params.js";
import { isEnvRef, isSecretRef } from "../config/cell-yaml-schema.js";
import { loadEnvForCell } from "../utils/env.js";
import { resolvePortsFromEnv } from "../config/ports.js";

type CommandResult = { exitCode: number; stdout: string; stderr: string };
type CommandOptions = { inheritStdio?: boolean; env?: Record<string, string | undefined> };
export type CommandRunner = (args: string[], options?: CommandOptions) => Promise<CommandResult>;
type AskFn = (prompt: string) => Promise<string>;
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type CloudflareZone = { id: string; name: string };

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_DIM = "\x1b[2m";

const runCommand: CommandRunner = async (args, options) => {
  const proc = Bun.spawn(args, {
    stdout: options?.inheritStdio ? "inherit" : "pipe",
    stderr: options?.inheritStdio ? "inherit" : "pipe",
    env: options?.env ? { ...process.env, ...options.env } : process.env,
  });
  const exitCode = await proc.exited;
  const stdout = options?.inheritStdio ? "" : await new Response(proc.stdout).text();
  const stderr = options?.inheritStdio ? "" : await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
};

/**
 * Collect all env var names referenced by !Env and !Secret in a params tree.
 */
function collectRefKeys(params: Record<string, unknown>): string[] {
  const keys = new Set<string>();

  function walk(value: unknown): void {
    if (value === null || value === undefined) return;
    if (isEnvRef(value)) {
      keys.add(value.env);
      return;
    }
    if (isSecretRef(value)) {
      keys.add(value.secret);
      return;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const v of Object.values(value as Record<string, unknown>)) {
        walk(v);
      }
    }
  }

  for (const v of Object.values(params)) {
    walk(v);
  }
  return [...keys];
}

/**
 * Setup command: check bun, otavia.yaml, each cell's cell.yaml; copy stack-host
 * .env.example -> .env when missing (rootDir only); optionally warn on:
 * - missing declared params (cell.yaml params not provided in otavia.yaml)
 * - missing env vars referenced by !Env/!Secret in otavia.yaml params.
 * options.tunnel: when true, write cloudflared tunnel config and print start instructions (no daemon).
 */
export async function setupCommand(
  rootDir: string,
  options?: { tunnel?: boolean; tunnelSpecified?: boolean }
): Promise<void> {
  // 1. Check bun is available
  try {
    const proc = await Bun.spawn(["bun", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    if (exit !== 0) {
      console.error("bun --version failed (exit code ", exit, ")");
      throw new Error("bun is not available");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "bun is not available") throw err;
    console.error("Failed to run bun --version:", err);
    throw new Error("bun is not available");
  }

  // 2. Load otavia.yaml (rethrow on error)
  const otavia = loadOtaviaYaml(rootDir);

  // 3. Stack-host env bootstrap: apps/main/.env.example -> apps/main/.env
  const rootEnvPath = path.join(rootDir, ".env");
  const rootEnvExamplePath = path.join(rootDir, ".env.example");
  if (existsSync(rootEnvPath)) {
    console.log("Skip .env: already exists (main)");
  } else if (existsSync(rootEnvExamplePath)) {
    copyFileSync(rootEnvExamplePath, rootEnvPath);
    console.log("Created .env from .env.example (main)");
  } else {
    console.log("Skip .env: no .env.example (main)");
  }

  // 4. Validate cells and warn missing env refs
  for (const entry of otavia.cellsList) {
    const cellDir = resolveCellDir(rootDir, entry.package);
    const cellYamlPath = path.join(cellDir, "cell.yaml");
    if (!existsSync(cellYamlPath)) {
      console.warn(`Warning: cell "${entry.mount}" (${entry.package}) not found, skipping.`);
      continue;
    }

    // Optional: warn on missing !Env/!Secret in params
    try {
      const cellConfig = loadCellConfig(cellDir);
      const merged = mergeParams(otavia.params as Record<string, unknown> | undefined, entry.params);
      try {
        assertDeclaredParamsProvided(cellConfig.params, merged, entry.mount);
      } catch (err) {
        if (err instanceof Error) {
          console.warn(err.message);
        }
      }
      const refKeys = collectRefKeys(merged);
      if (refKeys.length === 0) continue;

      const env = loadEnvForCell(rootDir, cellDir);
      // Empty string is a valid value for optional refs (e.g. COGNITO_CLIENT_SECRET in SSO).
      const missing = refKeys.filter((k) => env[k] === undefined);
      if (missing.length > 0) {
        console.warn(`Warning: missing env for ${entry.mount}: ${missing.join(", ")}`);
      }
    } catch {
      // Do not block: if cell.yaml fails to load or merge fails, skip warning
    }
  }

  const tunnelEnabled = await resolveTunnelSetupEnabled(options);
  if (tunnelEnabled) {
    const stageEnv = loadEnvForCell(rootDir, rootDir, { stage: "dev" });
    const ports = resolvePortsFromEnv("dev", { ...stageEnv, ...process.env });
    const configDir =
      process.env.OTAVIA_CONFIG_DIR ?? path.join(homedir(), ".config", "otavia");
    mkdirSync(configDir, { recursive: true });
    const inputs = await resolveTunnelInputs({ configDir });
    console.log("Checking cloudflared installation and authentication...");
    await ensureCloudflaredInstalled();
    await ensureCloudflaredLogin();
    const tunnel = await bootstrapNamedTunnel({
      configDir,
      devRoot: inputs.devRoot,
      machineName: inputs.machineName,
    });

    const tunnelConfigPath = path.join(configDir, "config.yml");
    const tunnelLegacyPath = path.join(configDir, "tunnel.yaml");
    const tunnelYaml = buildTunnelConfigYaml({
      tunnelName: tunnel.tunnelName,
      credentialsPath: tunnel.credentialsPath,
      hostname: tunnel.hostname,
      localPort: ports.frontend,
    });
    writeFileSync(tunnelConfigPath, tunnelYaml, "utf-8");
    writeFileSync(tunnelLegacyPath, tunnelYaml, "utf-8");

    const readmePath = path.join(configDir, "README.md");
    const readmeContent = [
      "Otavia tunnel is configured.",
      "",
      `Public host: https://${tunnel.hostname}`,
      `Tunnel name: ${tunnel.tunnelName}`,
      "",
      `Start tunnel: cloudflared tunnel --config "${tunnelConfigPath}" run`,
      "",
      "Then start otavia dev with tunnel mode:",
      "bun run otavia dev --tunnel --tunnel-config " + JSON.stringify(tunnelConfigPath),
      "",
    ].join("\n");
    writeFileSync(readmePath, readmeContent, "utf-8");

    console.log("Tunnel config written to", tunnelConfigPath);
    console.log("Public host:", `https://${tunnel.hostname}`);
    console.log("To start tunnel:");
    console.log(`  cloudflared tunnel --config "${tunnelConfigPath}" run`);

    try {
      await ensureOAuthCognitoCallback({
        rootDir,
        otavia,
        tunnelHost: tunnel.hostname,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: failed to ensure Cognito callback URL automatically: ${msg}`);
    }
  }
}

async function askYesNo(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  return answer.trim();
}

async function askText(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  return answer.trim();
}

export async function resolveTunnelSetupEnabled(
  options?: { tunnel?: boolean; tunnelSpecified?: boolean },
  deps?: { isTTY?: boolean; ask?: (prompt: string) => Promise<string> }
): Promise<boolean> {
  if (options?.tunnelSpecified) {
    return Boolean(options.tunnel);
  }
  // Backward compatibility for call sites that pass { tunnel: true } without tunnelSpecified.
  if (options?.tunnel === true) {
    return true;
  }
  const isTTY = deps?.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY) return false;
  const ask = deps?.ask ?? askYesNo;
  const answer = await ask("Configure Cloudflare tunnel for remote dev now? (y/N): ");
  return /^y(es)?$/i.test(answer);
}

function hostnameToSegment(host: string): string {
  let s = host
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (s.length > 63) s = s.slice(0, 63).replace(/-$/, "");
  if (!s || /^\d+$/.test(s)) return "dev";
  return s;
}

function normalizeDomain(input: string): string {
  return input.trim().replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase();
}

function isValidDevRootDomain(domain: string): boolean {
  if (!domain) return false;
  // Basic hostname validation: labels 1-63 chars, letters/digits/hyphen, at least one dot.
  if (!domain.includes(".")) return false;
  const labels = domain.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) return false;
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/i.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  return true;
}

function printCloudflareTokenInstructions(): void {
  console.log("");
  console.log(`${ANSI_BOLD}${ANSI_CYAN}=== Cloudflare API Token ===${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}${ANSI_YELLOW}[REQUIRED]${ANSI_RESET} Token is required for automatic DNS setup.`);
  console.log("");
  console.log(`${ANSI_BOLD}Step 1${ANSI_RESET}) Open: ${ANSI_CYAN}https://dash.cloudflare.com/profile/api-tokens${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}Step 2${ANSI_RESET}) Create token:`);
  console.log(`  - ${ANSI_BOLD}${ANSI_YELLOW}[RECOMMENDED]${ANSI_RESET} Use template ${ANSI_BOLD}'Edit zone DNS'${ANSI_RESET}`);
  console.log(`  - ${ANSI_BOLD}${ANSI_YELLOW}[FORM]${ANSI_RESET} In the next form (after selecting the template), set:`);
  console.log(`      * Permissions row #1: Zone / DNS / Edit`);
  console.log(`      * Click '+ Add more' and add row #2: Zone / Zone / Read`);
  console.log(`      * Zone Resources: default to Include -> All zones (or narrow to your dev zone)`);
  console.log(`      * Client IP filtering: leave empty`);
  console.log(`      * TTL: default no TTL (or set TTL per your security policy)`);
  console.log(`  ${ANSI_DIM}- [ADVANCED] If creating custom token, permissions:${ANSI_RESET}`);
  console.log(`  ${ANSI_DIM}    * Zone -> Zone -> Read${ANSI_RESET}`);
  console.log(`  ${ANSI_DIM}    * Zone -> DNS -> Edit${ANSI_RESET}`);
  console.log(`  ${ANSI_DIM}    * Zone -> SSL and Certificates -> Edit (optional, future cert automation)${ANSI_RESET}`);
  console.log("");
  console.log(`${ANSI_BOLD}${ANSI_YELLOW}[IMPORTANT]${ANSI_RESET}`);
  console.log(`  - Zone Resources should include the dev zone you plan to use.`);
  console.log(`  - We will use this token to auto-list zones and configure DNS records.`);
}

async function resolveTunnelInputs(deps?: {
  ask?: AskFn;
  isTTY?: boolean;
  hostName?: string;
  configDir?: string;
  fetchFn?: FetchFn;
}): Promise<{ devRoot: string; machineName: string }> {
  const ask = deps?.ask ?? askText;
  const isTTY = deps?.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const defaultMachine = hostnameToSegment(deps?.hostName ?? osHostname());
  const envRoot = normalizeDomain(process.env.OTAVIA_TUNNEL_DEV_ROOT ?? "");
  const envMachine = hostnameToSegment(process.env.OTAVIA_TUNNEL_MACHINE_NAME ?? defaultMachine);
  const configDir = deps?.configDir ?? process.env.OTAVIA_CONFIG_DIR ?? path.join(homedir(), ".config", "otavia");
  const tokenFilePath = path.join(configDir, "cloudflare-api-token");
  const envToken =
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    process.env.CF_API_TOKEN?.trim() ||
    (existsSync(tokenFilePath) ? readFileSync(tokenFilePath, "utf-8").trim() : "");

  if (!isTTY) {
    if (!envRoot) {
      throw new Error(
        "Tunnel setup in non-interactive mode requires OTAVIA_TUNNEL_DEV_ROOT (and optional OTAVIA_TUNNEL_MACHINE_NAME)."
      );
    }
    if (!envToken) {
      throw new Error(
        "Tunnel setup requires Cloudflare API token. Set CLOUDFLARE_API_TOKEN/CF_API_TOKEN, or save token to ~/.config/otavia/cloudflare-api-token."
      );
    }
    return { devRoot: envRoot, machineName: envMachine };
  }

  let token = envToken;
  if (token) {
    const change = await ask("Found saved Cloudflare API token. Change it? (y/N): ");
    if (/^y(es)?$/i.test(change.trim())) {
      token = "";
    }
  }
  if (!token) {
    printCloudflareTokenInstructions();
    for (;;) {
      const tokenInput = await ask("Cloudflare API token: ");
      if (!tokenInput.trim()) {
        console.warn("Cloudflare API token is required.");
        continue;
      }
      token = tokenInput.trim();
      mkdirSync(configDir, { recursive: true });
      writeFileSync(tokenFilePath, token, "utf-8");
      break;
    }
  }
  if (!token) {
    throw new Error(
      "Cloudflare API token is required. Please create one and rerun setup."
    );
  }

  let devRoot = envRoot;
  const zones = await fetchCloudflareZonesWithToken(token, deps?.fetchFn);
  if (!devRoot && zones.length === 0) {
    console.warn(
      "Warning: failed to auto-load Cloudflare zones."
    );
    console.warn(
      "This can be caused by token permissions (Zone:Read + DNS:Edit), network timeout, or Cloudflare API transient 5xx."
    );
    console.warn(
      "Please enter dev root domain manually now, then continue setup."
    );
  }
  if (!devRoot && zones.length > 0) {
    if (zones.length === 1) {
      devRoot = zones[0]!.name;
      console.log(`Auto-selected Cloudflare zone: ${devRoot}`);
    } else {
      for (;;) {
      console.log("Available Cloudflare zones:");
      zones.forEach((zone, idx) => console.log(`  ${idx + 1}. ${zone.name}`));
      const answer = await ask(
        `Select dev root domain by number (1-${zones.length}) or enter domain manually: `
      );
      const maybeIndex = parseInt(answer, 10);
      if (Number.isInteger(maybeIndex) && maybeIndex >= 1 && maybeIndex <= zones.length) {
        devRoot = zones[maybeIndex - 1]!.name;
        break;
      }
      if (!answer.trim()) {
        if (zones.length === 1) {
          devRoot = zones[0]!.name;
          break;
        }
        console.warn("Input is required. Enter a zone number or a valid domain.");
        continue;
      }
      const candidate = normalizeDomain(answer);
      if (isValidDevRootDomain(candidate)) {
        devRoot = candidate;
        break;
      }
      console.warn("Invalid domain format. Use a valid domain like dev.example.com.");
      }
    }
  }

  if (!devRoot) {
    for (;;) {
      const rootInput = await ask(
        `Dev root domain (e.g. dev.example.com)${envRoot ? ` [${envRoot}]` : ""}: `
      );
      const candidate = normalizeDomain(rootInput || envRoot);
      if (!candidate) {
        console.warn("Dev root domain is required.");
        continue;
      }
      if (!isValidDevRootDomain(candidate)) {
        console.warn("Invalid domain format. Use a valid domain like dev.example.com.");
        continue;
      }
      devRoot = candidate;
      break;
    }
  }

  const machineInput = await ask(`Machine name [${envMachine}]: `);
  const machineName = hostnameToSegment(machineInput || envMachine);
  return { devRoot, machineName };
}

export async function fetchCloudflareZonesWithToken(
  token: string,
  fetchFn?: FetchFn
): Promise<CloudflareZone[]> {
  const doFetch = fetchFn ?? fetch;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await doFetch("https://api.cloudflare.com/client/v4/zones?per_page=100", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        // Retry transient edge/network failures.
        if ((res.status >= 500 || res.status === 429) && attempt < maxAttempts) {
          await Bun.sleep(500 * attempt);
          continue;
        }
        return [];
      }
      const body = (await res.json()) as {
        success?: boolean;
        result?: Array<{ id?: string; name?: string }>;
      };
      if (!body.success || !Array.isArray(body.result)) return [];
      return body.result
        .filter((z) => typeof z.id === "string" && typeof z.name === "string")
        .map((z) => ({ id: z.id as string, name: z.name as string }));
    } catch {
      clearTimeout(timeout);
      if (attempt < maxAttempts) {
        await Bun.sleep(500 * attempt);
        continue;
      }
      return [];
    }
  }
  return [];
}

export function buildTunnelConfigYaml(input: {
  tunnelName: string;
  credentialsPath: string;
  hostname: string;
  localPort: number;
}): string {
  return [
    `tunnel: ${input.tunnelName}`,
    `credentials-file: ${input.credentialsPath}`,
    "ingress:",
    `  - hostname: ${JSON.stringify(input.hostname)}`,
    `    service: http://127.0.0.1:${input.localPort}`,
    "  - service: http_status:404",
    "",
  ].join("\n");
}

export function buildOAuthCallbackUrl(host: string, cell: string, callbackPath: string): string {
  const normalizedHost = host.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const normalizedCell = cell.trim().replace(/^\/+|\/+$/g, "");
  const normalizedPath = callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;
  return `https://${normalizedHost}/${normalizedCell}${normalizedPath}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isAwsSsoExpiredError(message: string): boolean {
  return /token has expired and refresh failed|expiredtoken|token is expired|the sso session has expired/i.test(
    message
  );
}

async function ensureOAuthCognitoCallback(input: {
  rootDir: string;
  otavia: ReturnType<typeof loadOtaviaYaml>;
  tunnelHost: string;
}): Promise<void> {
  const callback = input.otavia.oauth?.callback;
  if (!callback) return;

  const cellEntry = input.otavia.cellsList.find((entry) => entry.mount === callback.cell);
  if (!cellEntry) return;
  const cellDir = resolveCellDir(input.rootDir, cellEntry.package);
  const cellConfig = loadCellConfig(cellDir);
  if (!cellConfig.cognito) {
    console.warn(`Warning: oauth.callback cell "${callback.cell}" has no cognito config, skipping.`);
    return;
  }

  const merged = mergeParams(input.otavia.params as Record<string, unknown> | undefined, cellEntry.params);
  assertDeclaredParamsProvided(cellConfig.params, merged, cellEntry.mount);
  const envMap = loadEnvForCell(input.rootDir, cellDir, { stage: "dev" });
  if (!envMap.SSO_BASE_URL?.trim()) {
    const ports = resolvePortsFromEnv("dev", { ...envMap, ...process.env });
    envMap.SSO_BASE_URL = `http://localhost:${ports.backend}/${callback.cell}`;
  }
  const resolved = resolveParams(merged, envMap, { onMissingParam: "throw" });

  const region = asString(resolved.COGNITO_REGION);
  const userPoolId = asString(resolved.COGNITO_USER_POOL_ID);
  const clientId = asString(resolved.COGNITO_CLIENT_ID);
  if (!region || !userPoolId || !clientId) {
    console.warn(
      "Warning: COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID is incomplete, skipping callback registration."
    );
    return;
  }

  const callbackUrl = buildOAuthCallbackUrl(input.tunnelHost, callback.cell, callback.path);
  const profile = envMap.AWS_PROFILE ?? process.env.AWS_PROFILE;
  const awsRegion = envMap.AWS_REGION ?? process.env.AWS_REGION ?? region;
  try {
    await ensureCognitoCallbackUrl({
      region,
      userPoolId,
      clientId,
      callbackUrl,
      profile,
      awsRegion,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isAwsSsoExpiredError(msg)) {
      throw err;
    }
    const resolvedProfile = profile ?? "default";
    console.log(
      `AWS SSO token appears expired for profile "${resolvedProfile}". Running aws sso login and retrying Cognito callback registration...`
    );
    const login = await runCommand(
      ["aws", "sso", "login", "--profile", resolvedProfile],
      {
        inheritStdio: true,
        env: {
          AWS_PROFILE: resolvedProfile,
          AWS_REGION: awsRegion,
          AWS_DEFAULT_REGION: awsRegion,
        },
      }
    );
    if (login.exitCode !== 0) {
      throw new Error(`aws sso login failed for profile "${resolvedProfile}"`);
    }
    await ensureCognitoCallbackUrl({
      region,
      userPoolId,
      clientId,
      callbackUrl,
      profile: resolvedProfile,
      awsRegion,
    });
  }
}

async function ensureCognitoCallbackUrl(input: {
  region: string;
  userPoolId: string;
  clientId: string;
  callbackUrl: string;
  profile?: string;
  awsRegion?: string;
}): Promise<void> {
  const awsEnv: Record<string, string | undefined> = {
    AWS_REGION: input.awsRegion ?? input.region,
    AWS_DEFAULT_REGION: input.awsRegion ?? input.region,
    AWS_PROFILE: input.profile,
  };
  const describe = await runCommand(
    [
      "aws",
      "cognito-idp",
      "describe-user-pool-client",
      "--user-pool-id",
      input.userPoolId,
      "--client-id",
      input.clientId,
      "--output",
      "json",
    ],
    { env: awsEnv }
  );
  if (describe.exitCode !== 0) {
    throw new Error(describe.stderr || describe.stdout || "describe-user-pool-client failed");
  }
  const parsed = JSON.parse(describe.stdout || "{}") as {
    UserPoolClient?: CognitoClientForUpdate;
  };
  const client = parsed.UserPoolClient;
  if (!client) {
    throw new Error("describe-user-pool-client returned no UserPoolClient");
  }

  const existingCallbacks = Array.isArray(client.CallbackURLs) ? client.CallbackURLs : [];
  const localOrigin = new URL(input.callbackUrl).origin;
  const existingLogouts = Array.isArray(client.LogoutURLs) ? client.LogoutURLs : [];
  const nextCallbacks = Array.from(new Set([...existingCallbacks, input.callbackUrl]));
  const nextLogouts = Array.from(new Set([...existingLogouts, localOrigin]));
  const oauthNeedsRepair = client.AllowedOAuthFlowsUserPoolClient !== true;
  const discoveredIdentityProviders = await listCognitoIdentityProviders(
    runCommand,
    awsEnv,
    input.userPoolId
  );
  const mergedIdentityProviders = mergeSupportedIdentityProviders(
    client.SupportedIdentityProviders,
    discoveredIdentityProviders
  );
  const unchanged =
    nextCallbacks.length === existingCallbacks.length &&
    nextLogouts.length === existingLogouts.length &&
    !oauthNeedsRepair &&
    sameStringSet(client.SupportedIdentityProviders, mergedIdentityProviders);
  if (unchanged) {
    console.log(`Cognito callback already configured: ${input.callbackUrl}`);
    return;
  }

  const updateArgs = buildCognitoUserPoolClientUpdateArgs(
    client,
    nextCallbacks,
    nextLogouts,
    mergedIdentityProviders
  );
  const updated = await runCommand(
    [
      "aws",
      "cognito-idp",
      "update-user-pool-client",
      "--user-pool-id",
      input.userPoolId,
      "--client-id",
      input.clientId,
      ...updateArgs,
      "--output",
      "json",
    ],
    { env: awsEnv }
  );
  if (updated.exitCode !== 0) {
    throw new Error(updated.stderr || updated.stdout || "update-user-pool-client failed");
  }
  console.log(`Added Cognito callback URL: ${input.callbackUrl}`);
}

type CognitoClientForUpdate = {
  CallbackURLs?: string[];
  LogoutURLs?: string[];
  AllowedOAuthFlowsUserPoolClient?: boolean;
  AllowedOAuthFlows?: string[];
  AllowedOAuthScopes?: string[];
  SupportedIdentityProviders?: string[];
};

export function buildCognitoUserPoolClientUpdateArgs(
  client: CognitoClientForUpdate,
  nextCallbacks: string[],
  nextLogouts: string[],
  supportedIdentityProviders?: string[]
): string[] {
  const nextFlows = uniqueNonEmpty(client.AllowedOAuthFlows, ["code"]);
  const nextScopes = uniqueNonEmpty(client.AllowedOAuthScopes, ["openid", "email", "profile"]);
  const nextProviders = uniqueNonEmpty(
    supportedIdentityProviders ?? client.SupportedIdentityProviders,
    ["COGNITO"]
  );
  return [
    "--callback-urls",
    ...nextCallbacks,
    "--logout-urls",
    ...nextLogouts,
    "--allowed-o-auth-flows-user-pool-client",
    "--allowed-o-auth-flows",
    ...nextFlows,
    "--allowed-o-auth-scopes",
    ...nextScopes,
    "--supported-identity-providers",
    ...nextProviders,
  ];
}

function uniqueNonEmpty(input: string[] | undefined, fallback: string[]): string[] {
  const cleaned = (input ?? []).map((v) => v.trim()).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : fallback;
}

async function listCognitoIdentityProviders(
  run: CommandRunner,
  awsEnv: Record<string, string | undefined>,
  userPoolId: string
): Promise<string[]> {
  const listed = await run(
    [
      "aws",
      "cognito-idp",
      "list-identity-providers",
      "--user-pool-id",
      userPoolId,
      "--output",
      "json",
    ],
    { env: awsEnv }
  );
  if (listed.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(listed.stdout || "{}") as {
      Providers?: Array<{ ProviderName?: string }>;
    };
    return (parsed.Providers ?? [])
      .map((p) => p.ProviderName?.trim() ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mergeSupportedIdentityProviders(fromClient?: string[], fromUserPool?: string[]): string[] {
  return uniqueNonEmpty([...(fromClient ?? []), ...(fromUserPool ?? []), "COGNITO"], ["COGNITO"]);
}

function sameStringSet(left?: string[], right?: string[]): boolean {
  const a = Array.from(new Set((left ?? []).map((v) => v.trim()).filter(Boolean))).sort();
  const b = Array.from(new Set((right ?? []).map((v) => v.trim()).filter(Boolean))).sort();
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function bootstrapNamedTunnel(deps: {
  configDir: string;
  devRoot: string;
  machineName: string;
  run?: CommandRunner;
  log?: (msg: string) => void;
}): Promise<{ tunnelName: string; hostname: string; credentialsPath: string }> {
  const run = deps.run ?? runCommand;
  const log = deps.log ?? console.log;
  const machineName = hostnameToSegment(deps.machineName);
  const devRoot = normalizeDomain(deps.devRoot);
  if (!machineName) throw new Error("Invalid machine name for tunnel.");
  if (!devRoot) throw new Error("Invalid dev root domain for tunnel.");

  const tunnelName = `otavia-dev-${machineName}`;
  const hostname = `${machineName}.${devRoot}`;
  const credentialsPath = path.join(deps.configDir, "credentials.json");

  log(`Creating or reusing tunnel: ${tunnelName}`);
  const created = await run([
    "cloudflared",
    "tunnel",
    "create",
    "--credentials-file",
    credentialsPath,
    tunnelName,
  ]);
  const createErr = `${created.stdout}\n${created.stderr}`;
  if (
    created.exitCode !== 0 &&
    !/already exists/i.test(createErr)
  ) {
    throw new Error(`Failed to create tunnel ${tunnelName}: ${createErr.trim()}`);
  }

  log(`Routing DNS: ${hostname} -> ${tunnelName}`);
  const routed = await run([
    "cloudflared",
    "tunnel",
    "route",
    "dns",
    "--overwrite-dns",
    tunnelName,
    hostname,
  ]);
  const routeErr = `${routed.stdout}\n${routed.stderr}`;
  if (
    routed.exitCode !== 0 &&
    !/already exists|already registered/i.test(routeErr)
  ) {
    throw new Error(`Failed to route DNS for ${hostname}: ${routeErr.trim()}`);
  }

  return { tunnelName, hostname, credentialsPath };
}

export async function ensureCloudflaredInstalled(deps?: {
  run?: CommandRunner;
  platform?: NodeJS.Platform;
  log?: (msg: string) => void;
}): Promise<void> {
  const run = deps?.run ?? runCommand;
  const log = deps?.log ?? console.log;
  const platform = deps?.platform ?? process.platform;

  const version = await run(["cloudflared", "--version"]);
  if (version.exitCode === 0) return;

  log("cloudflared not found, attempting automatic installation...");
  if (platform !== "darwin") {
    throw new Error(
      "cloudflared is not installed. Automatic install is currently supported on macOS only. Please install cloudflared manually and rerun setup."
    );
  }

  const brew = await run(["brew", "--version"]);
  if (brew.exitCode !== 0) {
    throw new Error(
      "cloudflared is not installed and Homebrew is unavailable. Install Homebrew first or install cloudflared manually."
    );
  }

  log("Installing cloudflared via Homebrew...");
  const install = await run(["brew", "install", "cloudflared"], { inheritStdio: true });
  if (install.exitCode !== 0) {
    throw new Error("Automatic install failed: brew install cloudflared");
  }

  const verify = await run(["cloudflared", "--version"]);
  if (verify.exitCode !== 0) {
    throw new Error("cloudflared install verification failed. Please install it manually.");
  }
}

export async function ensureCloudflaredLogin(deps?: {
  run?: CommandRunner;
  log?: (msg: string) => void;
  hasExistingCert?: boolean;
}): Promise<void> {
  const run = deps?.run ?? runCommand;
  const log = deps?.log ?? console.log;
  const hasExistingCert =
    deps?.hasExistingCert ?? existsSync(path.join(homedir(), ".cloudflared", "cert.pem"));

  const list = await run(["cloudflared", "tunnel", "list"]);
  if (list.exitCode === 0) return;

  if (hasExistingCert) {
    log(
      "Found existing cloudflared cert.pem. Skipping forced login and retrying tunnel list..."
    );
    const retryList = await run(["cloudflared", "tunnel", "list"]);
    if (retryList.exitCode === 0) return;
    throw new Error(
      "cloudflared appears to have existing cert.pem, but tunnel list still failed. Check cloudflared auth/network and retry."
    );
  }

  log("Cloudflare login required, opening browser for cloudflared authentication...");
  const login = await run(["cloudflared", "tunnel", "login"], { inheritStdio: true });
  if (login.exitCode !== 0) {
    throw new Error("cloudflared tunnel login failed.");
  }

  const verify = await run(["cloudflared", "tunnel", "list"]);
  if (verify.exitCode !== 0) {
    throw new Error("cloudflared login verification failed (cloudflared tunnel list).");
  }
}
