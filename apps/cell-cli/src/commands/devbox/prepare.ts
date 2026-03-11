import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import * as readline from "node:readline";
import { join } from "node:path";
import { exec } from "../../local/docker.js";
import {
  DEVBOX_CONFIG_DIR,
  DEVBOX_CONFIG_PATH,
  DEVBOX_ROUTES_PATH,
  CLOUDFLARE_API_TOKEN_PATH,
  getCloudflareApiToken,
  loadDevboxConfig,
} from "../../config/devbox-config.js";
import { writeRoutes } from "../../local/devbox-routes.js";
import { loadEnvFiles } from "../../utils/env.js";

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Fetch zone names from Cloudflare API. Returns [] if token missing or request fails. */
async function fetchCloudflareZones(apiToken: string): Promise<string[]> {
  const res = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=50", {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { success?: boolean; result?: { name: string }[] };
  if (!data.success || !Array.isArray(data.result)) return [];
  return data.result.map((z) => z.name);
}

/** Convert OS hostname to a valid DNS label (lowercase, a-z 0-9 hyphen, 1–63 chars, no leading/trailing hyphen). */
function hostnameToSegment(hostname: string): string {
  let s = hostname
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (s.length > 63) s = s.slice(0, 63).replace(/-$/, "");
  if (!s || /^\d+$/.test(s)) return "dev";
  return s;
}

/** Valid devbox name = valid DNS label: 1–63 chars, a-z 0-9 hyphen, must start and end with alphanumeric, not all digits. */
function isValidDevboxName(name: string): boolean {
  if (!name || name.length > 63) return false;
  if (/^\d+$/.test(name)) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name);
}

const DEVBOX_NAME_RULES =
  "   Name must be a valid DNS label: 1–63 chars, only a-z 0-9 and hyphen, must start and end with letter or number, not all digits.";

export async function devboxPrepareCommand(): Promise<void> {
  console.log("=== Devbox prepare ===\n");

  // 1. Check bun (we're running under bun)
  console.log("1. Bun: OK (current runtime)\n");

  // 2. Check Docker (required)
  const { exitCode: dockerExit } = await exec(["docker", "info"]);
  if (dockerExit !== 0) {
    console.error("Docker is not running or not installed. Please start Docker and try again.");
    process.exit(1);
  }
  console.log("2. Docker: OK\n");

  // 3. Check cloudflared and login
  const { exitCode: cloudflaredExit } = await exec(["cloudflared", "--version"]);
  if (cloudflaredExit !== 0) {
    console.error("cloudflared not found. Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/");
    process.exit(1);
  }
  const { exitCode: listExit } = await exec(["cloudflared", "tunnel", "list"]);
  if (listExit !== 0) {
    console.log("3. Cloudflare: run 'cloudflared tunnel login' in your browser, then run 'cell devbox prepare' again.");
    process.exit(1);
  }
  console.log("3. Cloudflare: logged in\n");

  // 4. Cloudflare API token (global: zone list now + deploy DNS later). Reuse saved if exists.
  let cfToken: string | null = null;
  let cloudflareApiTokenPath: string | null = null;
  const envMap = loadEnvFiles(process.cwd());
  cfToken =
    (process.env.CLOUDFLARE_API_TOKEN ??
      process.env.CF_API_TOKEN ??
      envMap.CLOUDFLARE_API_TOKEN ??
      envMap.CF_API_TOKEN)
    ?.trim() ?? null;

  const existingDevbox = loadDevboxConfig();
  if (!cfToken && existingDevbox) {
    cfToken = getCloudflareApiToken({ devbox: existingDevbox, envMap });
    if (cfToken && existingDevbox.cloudflareApiTokenPath) {
      cloudflareApiTokenPath = existingDevbox.cloudflareApiTokenPath;
    }
  }
  // Also treat default token file as "saved" (e.g. user pasted in a previous run and we wrote it, even if prepare didn't finish)
  if (!cfToken && existsSync(CLOUDFLARE_API_TOKEN_PATH)) {
    try {
      const t = readFileSync(CLOUDFLARE_API_TOKEN_PATH, "utf-8").trim();
      if (t) {
        cfToken = t;
        cloudflareApiTokenPath = CLOUDFLARE_API_TOKEN_PATH;
      }
    } catch {
      /* ignore */
    }
  }

  if (cfToken) {
    const fromSaved = !!cloudflareApiTokenPath;
    const changeAnswer = await question(
      `Cloudflare API token already ${fromSaved ? "saved" : "set (from env)"}. Change it? (y/N): `
    );
    if (/^y(es)?$/i.test(changeAnswer.trim())) {
      cfToken = null;
      cloudflareApiTokenPath = null;
    }
  }

  if (!cfToken) {
    console.log("4. Cloudflare API token (used for zone list here + cell deploy DNS later).");
    console.log("");
    console.log("   \x1b[1mStep 1:\x1b[0m Open \x1b[1;36mhttps://dash.cloudflare.com/profile/api-tokens\x1b[0m");
    console.log("   \x1b[1mStep 2:\x1b[0m Click \"Create Token\" and choose template \x1b[1;36mEdit zone DNS\x1b[0m (Zone:Read + Zone:DNS:Edit).");
    console.log("   \x1b[1mStep 3:\x1b[0m On the form:");
    console.log("      • Zone Resources: set to \x1b[1;36mInclude → All zones\x1b[0m (so prepare and deploy work for any zone).");
    console.log("      • Client IP / TTL: leave default unless you need to restrict.");
    console.log("      • Continue to Create Token, then paste the token below.");
    console.log("");
    const tokenInput = await question(
      "Paste token (or press Enter to type dev root domain manually later): "
    );
    if (tokenInput.trim()) {
      cfToken = tokenInput.trim();
      mkdirSync(DEVBOX_CONFIG_DIR, { recursive: true });
      writeFileSync(CLOUDFLARE_API_TOKEN_PATH, cfToken, "utf-8");
      chmodSync(CLOUDFLARE_API_TOKEN_PATH, 0o600);
      cloudflareApiTokenPath = CLOUDFLARE_API_TOKEN_PATH;
      console.log("   Saved to", CLOUDFLARE_API_TOKEN_PATH, "\n");
    }
  }

  let devRoot: string;
  const zones = cfToken ? await fetchCloudflareZones(cfToken) : [];
  if (cfToken && zones.length === 0) {
    console.warn("  Could not list zones (invalid token or no zones). You can type the domain below.\n");
  }

  if (zones.length > 0) {
    console.log("5. Select dev root domain (zone in your Cloudflare account):\n");
    zones.forEach((name, i) => console.log(`   ${i + 1}. ${name}`));
    console.log("");
    if (zones.length === 1) {
      devRoot = zones[0]!;
      console.log("  →", devRoot, " (only one zone, auto-selected)\n");
    } else {
      const raw = await question(`Enter number (1-${zones.length}) or domain name: `);
      const num = parseInt(raw, 10);
      if (Number.isInteger(num) && num >= 1 && num <= zones.length) {
        devRoot = zones[num - 1]!;
      } else if (zones.includes(raw)) {
        devRoot = raw;
      } else if (raw) {
        devRoot = raw;
        console.warn("  (Not in zone list; make sure this domain is in your Cloudflare account.)");
      } else {
        console.error("devRoot is required.");
        process.exit(1);
      }
      console.log("  →", devRoot, "\n");
    }
  } else {
    devRoot = await question("Dev root domain (e.g. example.com, must be in your Cloudflare account): ");
    if (!devRoot) {
      console.error("devRoot is required.");
      process.exit(1);
    }
  }

  const defaultDevboxName = hostnameToSegment(osHostname());
  let devboxName: string;
  for (;;) {
    const raw = await question(`This machine name [${defaultDevboxName}]: `);
    let candidate = raw ? raw.trim() : defaultDevboxName;
    candidate = hostnameToSegment(candidate);
    if (!candidate) candidate = defaultDevboxName;
    devboxName = candidate;
    if (isValidDevboxName(devboxName)) break;
    console.warn(DEVBOX_NAME_RULES);
    console.warn("");
  }

  const tunnelPort = 8443;
  const tunnelName = `casfa-dev-${devboxName}`;
  const hostname = `${devboxName}.${devRoot}`;
  const credentialsPath = join(DEVBOX_CONFIG_DIR, "credentials.json");

  // 6. Create tunnel (if not exists)
  mkdirSync(DEVBOX_CONFIG_DIR, { recursive: true });
  const { exitCode: createExit, stdout: createOut, stderr: createErr } = await exec([
    "cloudflared",
    "tunnel",
    "create",
    "--credentials-file",
    credentialsPath,
    tunnelName,
  ]);
  if (createExit !== 0 && !createErr.includes("already exists")) {
    console.error("Tunnel create failed:", createErr || createOut);
    process.exit(1);
  }
  if (createExit === 0) {
    console.log("Tunnel created:", tunnelName);
  } else {
    console.log("Tunnel already exists:", tunnelName);
  }

  // 7. Route DNS
  const { exitCode: dnsExit, stderr: dnsErr } = await exec([
    "cloudflared",
    "tunnel",
    "route",
    "dns",
    tunnelName,
    hostname,
  ]);
  if (dnsExit !== 0 && !dnsErr.includes("already exists") && !dnsErr.includes("already registered")) {
    console.warn("DNS route warning:", dnsErr);
  } else {
    console.log("DNS route:", hostname, "->", tunnelName);
  }

  // 8. Write devbox.yaml
  const devboxYamlLines = [
    "devboxName: " + JSON.stringify(devboxName),
    "devRoot: " + JSON.stringify(devRoot),
    "tunnelPort: " + tunnelPort,
    "tunnelId: " + JSON.stringify(tunnelName),
    "credentialsPath: " + JSON.stringify(credentialsPath),
    "proxyRegistryPath: " + JSON.stringify(DEVBOX_ROUTES_PATH),
  ];
  if (cloudflareApiTokenPath) {
    devboxYamlLines.push("cloudflareApiTokenPath: " + JSON.stringify(cloudflareApiTokenPath));
  }
  devboxYamlLines.push("");
  const devboxYaml = devboxYamlLines.join("\n");
  writeFileSync(DEVBOX_CONFIG_PATH, devboxYaml, "utf-8");
  console.log("Wrote", DEVBOX_CONFIG_PATH);

  // 9. Init routes file
  writeRoutes({}, DEVBOX_ROUTES_PATH);
  console.log("Initialized", DEVBOX_ROUTES_PATH);

  // 10. Write cloudflared config for tunnel run
  const cloudflaredConfigPath = join(DEVBOX_CONFIG_DIR, "config.yml");
  const cloudflaredConfig = [
    "tunnel: " + tunnelName,
    "credentials-file: " + credentialsPath,
    "ingress:",
    "  - hostname: " + hostname,
    "    service: http://127.0.0.1:" + tunnelPort,
    "  - service: http_status:404",
    "",
  ].join("\n");
  writeFileSync(cloudflaredConfigPath, cloudflaredConfig, "utf-8");
  console.log("Wrote", cloudflaredConfigPath);

  console.log("");
  console.log("=== Done ===");
  console.log("Run 'cell devbox start' to start proxy and tunnel.");
  console.log("Then run 'cell dev' in any cell with domain; routes will be registered automatically.");
}
