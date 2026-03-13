import { describe, expect, test } from "bun:test";
import { extractTunnelHostFromConfig, normalizeTunnelPublicBaseUrl } from "../tunnel";

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
