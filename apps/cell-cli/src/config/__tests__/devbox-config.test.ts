import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  getDevHost,
  getCloudflareApiToken,
  loadDevboxConfig,
  DEVBOX_CONFIG_DIR,
  DEVBOX_CONFIG_PATH,
  DEVBOX_ROUTES_PATH,
  CLOUDFLARE_API_TOKEN_PATH,
} from "../devbox-config.js";

describe("devbox-config", () => {
  test("path constants are under .config/casfa", () => {
    expect(DEVBOX_CONFIG_DIR).toEndWith(".config/casfa");
    expect(DEVBOX_CONFIG_PATH).toBe(join(DEVBOX_CONFIG_DIR, "devbox.yaml"));
    expect(DEVBOX_ROUTES_PATH).toBe(join(DEVBOX_CONFIG_DIR, "devbox-routes.json"));
    expect(CLOUDFLARE_API_TOKEN_PATH).toBe(join(DEVBOX_CONFIG_DIR, "cloudflare-api-token"));
  });

  test("loadDevboxConfig returns null when file does not exist", () => {
    expect(loadDevboxConfig(join(tmpdir(), "nonexistent-devbox.yaml"))).toBeNull();
  });

  test("loadDevboxConfig parses valid YAML and returns config", () => {
    const dir = join(tmpdir(), `devbox-config-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "devbox.yaml");
    writeFileSync(
      path,
      `
devboxName: my-mbp
devRoot: example.com
tunnelPort: 8443
tunnelId: my-tunnel-id
credentialsPath: /tmp/creds.json
proxyRegistryPath: /custom/routes.json
`.trim()
    );
    const config = loadDevboxConfig(path);
    expect(config).not.toBeNull();
    expect(config!.devboxName).toBe("my-mbp");
    expect(config!.devRoot).toBe("example.com");
    expect(config!.tunnelPort).toBe(8443);
    expect(config!.tunnelId).toBe("my-tunnel-id");
    expect(config!.credentialsPath).toBe("/tmp/creds.json");
    expect(config!.proxyRegistryPath).toBe("/custom/routes.json");
  });

  test("loadDevboxConfig returns null for invalid YAML (missing required)", () => {
    const dir = join(tmpdir(), `devbox-config-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "bad.yaml");
    writeFileSync(path, "tunnelPort: 8443\n");
    expect(loadDevboxConfig(path)).toBeNull();
  });

  test("getDevHost builds subdomain.devboxName.devRoot", () => {
    const devbox = {
      devboxName: "my-mbp",
      devRoot: "example.com",
      tunnelPort: 8443,
    };
    expect(getDevHost("sso.casfa", devbox)).toBe("sso.casfa.my-mbp.example.com");
    expect(getDevHost("drive.casfa", devbox)).toBe("drive.casfa.my-mbp.example.com");
  });

  test("getCloudflareApiToken returns from env first", () => {
    const orig = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "env-token";
    try {
      expect(getCloudflareApiToken({})).toBe("env-token");
      expect(getCloudflareApiToken({ envMap: {} })).toBe("env-token");
    } finally {
      if (orig !== undefined) process.env.CLOUDFLARE_API_TOKEN = orig;
      else delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  test("getCloudflareApiToken returns from devbox file when env not set", () => {
    const dir = join(tmpdir(), `devbox-config-token-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const tokenPath = join(dir, "cf-token");
    writeFileSync(tokenPath, " file-token\n", "utf-8");
    const devbox = {
      devboxName: "x",
      devRoot: "example.com",
      tunnelPort: 8443,
      cloudflareApiTokenPath: tokenPath,
    };
    const orig = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      expect(getCloudflareApiToken({ devbox })).toBe("file-token");
    } finally {
      if (orig !== undefined) process.env.CLOUDFLARE_API_TOKEN = orig;
    }
  });
});
