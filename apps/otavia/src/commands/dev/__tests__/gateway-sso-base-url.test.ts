import { describe, expect, test } from "bun:test";
import { applyResourceNameEnvVars, resolveGatewaySsoBaseUrl } from "../gateway";
import { resolveRootRedirectMount } from "../mount-selection";

describe("resolveGatewaySsoBaseUrl", () => {
  test("prefers configured SSO base URL from env", () => {
    expect(resolveGatewaySsoBaseUrl("http://localhost:7100/sso", 8900, "sso")).toBe(
      "http://localhost:7100/sso"
    );
  });

  test("falls back to backend mount URL when env is missing", () => {
    expect(resolveGatewaySsoBaseUrl(undefined, 8900, "sso")).toBe("http://localhost:8900/sso");
  });
});

describe("applyResourceNameEnvVars", () => {
  test("injects DYNAMODB_TABLE_* and S3_BUCKET_* env vars from stack/mount/key", () => {
    const cells = [
      {
        mount: "agent",
        cellDir: "/tmp/agent",
        packageName: "@casfa/agent",
        config: {
          name: "agent",
          params: [],
          tables: {
            settings: { keys: { pk: "S", sk: "S" } },
            pending_client_info: { keys: { pk: "S" } },
          },
          buckets: {
            uploads: {},
          },
        },
        env: {} as Record<string, string>,
      },
    ] as any;

    applyResourceNameEnvVars(cells, "otavia-local");

    expect(cells[0].env.DYNAMODB_TABLE_SETTINGS).toBe("otavia-local-agent-settings");
    expect(cells[0].env.DYNAMODB_TABLE_PENDING_CLIENT_INFO).toBe(
      "otavia-local-agent-pending-client-info"
    );
    expect(cells[0].env.S3_BUCKET_UPLOADS).toBe("otavia-local-agent-uploads");
  });
});

describe("resolveRootRedirectMount", () => {
  test("prefers configured mount when it is mounted", () => {
    expect(resolveRootRedirectMount(["sso", "drive", "agent"], "drive")).toBe("drive");
  });

  test("falls back to first mount when configured mount is absent", () => {
    expect(resolveRootRedirectMount(["sso", "agent"], "drive")).toBe("sso");
  });

  test("falls back to first mount when no preferred mount is configured", () => {
    expect(resolveRootRedirectMount(["sso", "drive", "agent"])).toBe("sso");
  });

  test("returns empty string when there are no mounts", () => {
    expect(resolveRootRedirectMount([])).toBe("");
  });
});
