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
  test("Route 53 A record with correct alias", () => {
    const config = makeConfig({
      domain: {
        zone: "example.com",
        host: "app.example.com",
        certificate: "arn:aws:acm:us-east-1:123:certificate/abc",
      },
    });
    const result = generateDomain(config);
    const record = result.Resources.DnsRecord as any;
    expect(record.Type).toBe("AWS::Route53::RecordSet");
    expect(record.Properties.Type).toBe("A");
    expect(record.Properties.Name).toBe("app.example.com");
    expect(record.Properties.HostedZoneName).toBe("example.com.");
    expect(record.Properties.AliasTarget.DNSName).toEqual({
      "Fn::GetAtt": ["FrontendCloudFront", "DomainName"],
    });
  });

  test("HostedZoneId is Z2FDTNDATAQYW2", () => {
    const config = makeConfig({
      domain: {
        zone: "example.com",
        host: "app.example.com",
        certificate: "arn:aws:acm:us-east-1:123:certificate/abc",
      },
    });
    const result = generateDomain(config);
    const record = result.Resources.DnsRecord as any;
    expect(record.Properties.AliasTarget.HostedZoneId).toBe("Z2FDTNDATAQYW2");
  });

  test("no record when domain not configured", () => {
    const config = makeConfig();
    const result = generateDomain(config);
    expect(Object.keys(result.Resources)).toHaveLength(0);
  });
});
