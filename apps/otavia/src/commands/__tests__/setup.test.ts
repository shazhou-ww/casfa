import { describe, expect, test } from "bun:test";
import {
  buildCognitoUserPoolClientUpdateArgs,
  buildOAuthCallbackUrl,
  buildTunnelConfigYaml,
  bootstrapNamedTunnel,
  ensureCloudflaredInstalled,
  ensureCloudflaredLogin,
  fetchCloudflareZonesWithToken,
  isAwsSsoExpiredError,
  resolveTunnelSetupEnabled,
  type CommandRunner,
} from "../setup";

describe("resolveTunnelSetupEnabled", () => {
  test("uses explicit --tunnel=true without prompting", async () => {
    const enabled = await resolveTunnelSetupEnabled(
      { tunnel: true, tunnelSpecified: true },
      {
        isTTY: true,
        ask: async () => {
          throw new Error("should not ask");
        },
      }
    );
    expect(enabled).toBe(true);
  });

  test("uses explicit --tunnel=false without prompting", async () => {
    const enabled = await resolveTunnelSetupEnabled(
      { tunnel: false, tunnelSpecified: true },
      {
        isTTY: true,
        ask: async () => {
          throw new Error("should not ask");
        },
      }
    );
    expect(enabled).toBe(false);
  });

  test("defaults to false when non-interactive and option unspecified", async () => {
    const enabled = await resolveTunnelSetupEnabled(
      { tunnelSpecified: false },
      {
        isTTY: false,
      }
    );
    expect(enabled).toBe(false);
  });

  test("prompts user when interactive and option unspecified", async () => {
    const enabled = await resolveTunnelSetupEnabled(
      { tunnelSpecified: false },
      {
        isTTY: true,
        ask: async () => "y",
      }
    );
    expect(enabled).toBe(true);
  });
});

function makeRunner(sequence: Array<{ cmd: string; exitCode: number }>): CommandRunner {
  let idx = 0;
  return async (args) => {
    const step = sequence[idx];
    if (!step) {
      throw new Error(`unexpected command: ${args.join(" ")}`);
    }
    expect(args.join(" ")).toBe(step.cmd);
    idx += 1;
    return { exitCode: step.exitCode, stdout: "", stderr: "" };
  };
}

describe("ensureCloudflaredInstalled", () => {
  test("installs with brew on macOS when cloudflared is missing", async () => {
    const run = makeRunner([
      { cmd: "cloudflared --version", exitCode: 1 },
      { cmd: "brew --version", exitCode: 0 },
      { cmd: "brew install cloudflared", exitCode: 0 },
      { cmd: "cloudflared --version", exitCode: 0 },
    ]);
    await ensureCloudflaredInstalled({ run, platform: "darwin" });
  });
});

describe("ensureCloudflaredLogin", () => {
  test("runs cloudflared tunnel login when not logged in", async () => {
    const run = makeRunner([
      { cmd: "cloudflared tunnel list", exitCode: 1 },
      { cmd: "cloudflared tunnel login", exitCode: 0 },
      { cmd: "cloudflared tunnel list", exitCode: 0 },
    ]);
    await ensureCloudflaredLogin({ run, hasExistingCert: false });
  });

  test("does not force login when cert exists; retries list", async () => {
    const run = makeRunner([
      { cmd: "cloudflared tunnel list", exitCode: 1 },
      { cmd: "cloudflared tunnel list", exitCode: 0 },
    ]);
    await ensureCloudflaredLogin({ run, hasExistingCert: true });
  });
});

describe("bootstrapNamedTunnel", () => {
  test("creates tunnel and routes DNS", async () => {
    const run = makeRunner([
      {
        cmd: "cloudflared tunnel create --credentials-file /tmp/otavia/credentials.json otavia-dev-mybox",
        exitCode: 0,
      },
      {
        cmd: "cloudflared tunnel route dns --overwrite-dns otavia-dev-mybox mybox.dev.example.com",
        exitCode: 0,
      },
    ]);
    const result = await bootstrapNamedTunnel({
      configDir: "/tmp/otavia",
      devRoot: "dev.example.com",
      machineName: "mybox",
      run,
    });
    expect(result.tunnelName).toBe("otavia-dev-mybox");
    expect(result.hostname).toBe("mybox.dev.example.com");
    expect(result.credentialsPath).toBe("/tmp/otavia/credentials.json");
  });
});

describe("buildTunnelConfigYaml", () => {
  test("renders config for fixed host", () => {
    const yaml = buildTunnelConfigYaml({
      tunnelName: "otavia-dev-mybox",
      credentialsPath: "/tmp/otavia/credentials.json",
      hostname: "mybox.dev.example.com",
      localPort: 7100,
    });
    expect(yaml).toContain("tunnel: otavia-dev-mybox");
    expect(yaml).toContain('hostname: "mybox.dev.example.com"');
    expect(yaml).toContain("service: http://127.0.0.1:7100");
  });
});

describe("buildOAuthCallbackUrl", () => {
  test("builds callback URL from host + cell + path", () => {
    expect(buildOAuthCallbackUrl("mybox.dev.example.com", "sso", "/oauth/callback")).toBe(
      "https://mybox.dev.example.com/sso/oauth/callback"
    );
  });
});

describe("fetchCloudflareZonesWithToken", () => {
  test("returns zones on successful API response", async () => {
    const zones = await fetchCloudflareZonesWithToken("token", async () => {
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            { id: "z1", name: "example.com" },
            { id: "z2", name: "dev.example.com" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    expect(zones).toEqual([
      { id: "z1", name: "example.com" },
      { id: "z2", name: "dev.example.com" },
    ]);
  });

  test("returns empty list on API failure", async () => {
    const zones = await fetchCloudflareZonesWithToken("token", async () => {
      return new Response("denied", { status: 403 });
    });
    expect(zones).toEqual([]);
  });
});

describe("isAwsSsoExpiredError", () => {
  test("detects common AWS SSO expiration errors", () => {
    expect(isAwsSsoExpiredError("Error when retrieving token from sso: Token has expired and refresh failed")).toBe(true);
    expect(isAwsSsoExpiredError("ExpiredToken: The security token included in the request is expired")).toBe(true);
  });

  test("does not match unrelated errors", () => {
    expect(isAwsSsoExpiredError("AccessDeniedException: User is not authorized")).toBe(false);
  });
});

describe("buildCognitoUserPoolClientUpdateArgs", () => {
  test("keeps existing OAuth config when present", () => {
    const args = buildCognitoUserPoolClientUpdateArgs(
      {
        AllowedOAuthFlows: ["code"],
        AllowedOAuthScopes: ["openid", "email", "profile"],
        SupportedIdentityProviders: ["COGNITO"],
      },
      ["https://mymbp.shazhou.work/sso/oauth/callback"],
      ["https://mymbp.shazhou.work"]
    );
    expect(args).toContain("--allowed-o-auth-flows-user-pool-client");
    expect(args).toEqual(
      expect.arrayContaining([
        "--allowed-o-auth-flows",
        "code",
        "--allowed-o-auth-scopes",
        "openid",
        "email",
        "profile",
        "--supported-identity-providers",
        "COGNITO",
      ])
    );
  });

  test("falls back to safe OAuth defaults when describe has empty lists", () => {
    const args = buildCognitoUserPoolClientUpdateArgs(
      {
        AllowedOAuthFlows: [],
        AllowedOAuthScopes: [],
        SupportedIdentityProviders: [],
      },
      ["https://mymbp.shazhou.work/sso/oauth/callback"],
      ["https://mymbp.shazhou.work"]
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "--allowed-o-auth-flows",
        "code",
        "--allowed-o-auth-scopes",
        "openid",
        "email",
        "profile",
        "--supported-identity-providers",
        "COGNITO",
      ])
    );
  });

  test("uses merged identity providers when explicitly provided", () => {
    const args = buildCognitoUserPoolClientUpdateArgs(
      {
        AllowedOAuthFlows: ["code"],
        AllowedOAuthScopes: ["openid", "email", "profile"],
        SupportedIdentityProviders: ["COGNITO"],
      },
      ["https://mymbp.shazhou.work/sso/oauth/callback"],
      ["https://mymbp.shazhou.work"],
      ["COGNITO", "Google", "Microsoft"]
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "--supported-identity-providers",
        "COGNITO",
        "Google",
        "Microsoft",
      ])
    );
  });
});
