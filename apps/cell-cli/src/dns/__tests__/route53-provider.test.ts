import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { Route53Provider } from "../route53-provider.js";

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

describe("Route53Provider", () => {
  const provider = new Route53Provider();

  describe("generateCfnResources", () => {
    test("generates Route53 A record when domain has hostedZoneId", () => {
      const config = makeConfig({
        domain: {
          alias: "app",
          zone: "example.com",
          host: "app.example.com",
          hostedZoneId: "Z1234567890",
        },
      });
      const result = provider.generateCfnResources(config);
      const record = result.Resources.DnsRecord as any;
      expect(record.Type).toBe("AWS::Route53::RecordSet");
      expect(record.Properties.Type).toBe("A");
      expect(record.Properties.Name).toBe("app.example.com");
      expect(record.Properties.HostedZoneName).toBe("example.com.");
      expect(record.Properties.AliasTarget.HostedZoneId).toBe("Z2FDTNDATAQYW2");
    });

    test("no resources when domain not configured", () => {
      const config = makeConfig();
      const result = provider.generateCfnResources(config);
      expect(Object.keys(result.Resources)).toHaveLength(0);
    });

    test("no resources when hostedZoneId is missing", () => {
      const config = makeConfig({
        domain: { alias: "app", zone: "example.com", host: "app.example.com" },
      });
      const result = provider.generateCfnResources(config);
      expect(Object.keys(result.Resources)).toHaveLength(0);
    });
  });

  describe("ensureCertificate", () => {
    test("returns null (CloudFormation handles it)", async () => {
      const mockCli = async () => ({ exitCode: 0, stdout: "" });
      const result = await provider.ensureCertificate("app.example.com", mockCli, {});
      expect(result).toBeNull();
    });
  });

  describe("ensureDnsRecords", () => {
    test("is a no-op (CloudFormation handles it)", async () => {
      await provider.ensureDnsRecords("app.example.com", "d123.cloudfront.net");
    });
  });
});
