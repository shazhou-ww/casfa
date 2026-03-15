import { describe, expect, test } from "bun:test";
import {
  buildCloudflaredTunnelCommand,
  extractTunnelHostFromConfig,
  normalizeTunnelPublicBaseUrl,
  resolveTunnelLogLevel,
  resolveTunnelProtocol,
} from "../tunnel";

describe("extractTunnelHostFromConfig", () => {
  test("returns first non-wildcard hostname in ingress", () => {
    const config = `
tunnel: otavia-dev-mybox
credentials-file: /tmp/credentials.json
ingress:
  - hostname: "*.mybox.dev.example.com"
    service: http://127.0.0.1:7100
  - hostname: "mybox.dev.example.com"
    service: http://127.0.0.1:7100
  - service: http_status:404
`;
    expect(extractTunnelHostFromConfig(config)).toBe("mybox.dev.example.com");
  });

  test("returns null when no hostname is configured", () => {
    const config = `
tunnel: otavia-dev-mybox
credentials-file: /tmp/credentials.json
ingress:
  - service: http://127.0.0.1:7100
  - service: http_status:404
`;
    expect(extractTunnelHostFromConfig(config)).toBeNull();
  });
});

describe("normalizeTunnelPublicBaseUrl", () => {
  test("adds https scheme for plain host", () => {
    expect(normalizeTunnelPublicBaseUrl("mybox.dev.example.com")).toBe(
      "https://mybox.dev.example.com"
    );
  });

  test("trims trailing slash when already full URL", () => {
    expect(normalizeTunnelPublicBaseUrl("https://mybox.dev.example.com/")).toBe(
      "https://mybox.dev.example.com"
    );
  });
});

describe("resolveTunnelLogLevel", () => {
  test("defaults to warn", () => {
    expect(resolveTunnelLogLevel()).toBe("warn");
  });

  test("normalizes mixed-case level", () => {
    expect(resolveTunnelLogLevel("InFo")).toBe("info");
  });

  test("throws on invalid value", () => {
    expect(() => resolveTunnelLogLevel("verbose")).toThrow(
      'Invalid tunnel log level "verbose". Expected one of: debug, info, warn, error.'
    );
  });
});

describe("buildCloudflaredTunnelCommand", () => {
  test("builds command with quoted config path and log level", () => {
    expect(buildCloudflaredTunnelCommand("/tmp/dev config.yml", "warn", "quic")).toBe(
      'cloudflared tunnel --loglevel warn --protocol quic --config "/tmp/dev config.yml" run'
    );
  });
});

describe("resolveTunnelProtocol", () => {
  test("defaults to quic", () => {
    expect(resolveTunnelProtocol()).toBe("quic");
  });

  test("normalizes mixed-case protocol", () => {
    expect(resolveTunnelProtocol("Http2")).toBe("http2");
  });

  test("allows auto protocol", () => {
    expect(resolveTunnelProtocol("auto")).toBe("auto");
  });

  test("throws on invalid protocol", () => {
    expect(() => resolveTunnelProtocol("ws")).toThrow(
      'Invalid tunnel protocol "ws". Expected one of: auto, quic, http2.'
    );
  });
});
