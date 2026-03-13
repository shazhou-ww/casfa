import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateDomain } from "../domain.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    name: "test-app",
    envVars: {},
    secretRefs: {},
    tables: [],
    buckets: [],
    frontendBucketName: "test-app-frontend",
    ...overrides,
  };
}

describe("generateDomain", () => {
  test("Route53 A record when dns is route53 and hostedZoneId present", () => {
    const config = makeConfig({
      domain: {
        alias: "app",
        zone: "example.com",
        host: "app.example.com",
        subdomain: "app",
        dns: "route53",
        hostedZoneId: "Z1234567890",
      },
    });
    const result = generateDomain(config);
    const record = result.Resources.DnsRecord as any;
    expect(record.Type).toBe("AWS::Route53::RecordSet");
    expect(record.Properties.Type).toBe("A");
    expect(record.Properties.Name).toBe("app.example.com");
    expect(record.Properties.HostedZoneName).toBe("example.com.");
    expect(record.Properties.AliasTarget.HostedZoneId).toBe("Z2FDTNDATAQYW2");
  });

  test("no record when domain not configured", () => {
    const config = makeConfig();
    const result = generateDomain(config);
    expect(Object.keys(result.Resources)).toHaveLength(0);
  });

  test("no record when dns is cloudflare", () => {
    const config = makeConfig({
      domain: {
        alias: "app",
        zone: "example.com",
        host: "app.example.com",
        subdomain: "app",
        dns: "cloudflare",
        cloudflare: { zoneId: "zone123", apiToken: "token" },
      },
    });
    const result = generateDomain(config);
    expect(Object.keys(result.Resources)).toHaveLength(0);
  });

  test("no record when dns is route53 but hostedZoneId missing", () => {
    const config = makeConfig({
      domain: { alias: "app", zone: "example.com", host: "app.example.com", subdomain: "app" },
    });
    const result = generateDomain(config);
    expect(Object.keys(result.Resources)).toHaveLength(0);
  });

  test("default dns (undefined) with hostedZoneId generates Route53 record", () => {
    const config = makeConfig({
      domain: {
        alias: "app",
        zone: "example.com",
        host: "app.example.com",
        subdomain: "app",
        hostedZoneId: "Z1234567890",
      },
    });
    const result = generateDomain(config);
    expect(result.Resources.DnsRecord).toBeDefined();
  });
});
