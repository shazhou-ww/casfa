import { describe, expect, mock, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { CloudflareProvider } from "../cloudflare-provider.js";

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

describe("CloudflareProvider", () => {
  const provider = new CloudflareProvider("zone-id-123", "cf-api-token-456");

  describe("generateCfnResources", () => {
    test("returns empty resources (DNS managed outside CloudFormation)", () => {
      const config = makeConfig({
        domain: {
          alias: "app",
          zone: "example.com",
          host: "app.example.com",
          dns: "cloudflare",
          cloudflare: { zoneId: "zone-id-123", apiToken: "token" },
        },
      });
      const result = provider.generateCfnResources(config);
      expect(Object.keys(result.Resources)).toHaveLength(0);
    });
  });

  describe("ensureCertificate", () => {
    test("returns existing cert ARN if one exists for the domain", async () => {
      const mockCli = mock(async (args: string[]) => {
        if (args[0] === "acm" && args[1] === "list-certificates") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              CertificateSummaryList: [
                { DomainName: "app.example.com", CertificateArn: "arn:aws:acm:us-east-1:123:certificate/existing", Status: "ISSUED" },
              ],
            }),
          };
        }
        return { exitCode: 0, stdout: "" };
      });

      const result = await provider.ensureCertificate("app.example.com", mockCli, {});
      expect(result).toBe("arn:aws:acm:us-east-1:123:certificate/existing");
    });

    test("requests new cert when none exists", async () => {
      const calls: string[][] = [];
      const mockCli = mock(async (args: string[]) => {
        calls.push(args);
        if (args[0] === "acm" && args[1] === "list-certificates") {
          return { exitCode: 0, stdout: JSON.stringify({ CertificateSummaryList: [] }) };
        }
        if (args[0] === "acm" && args[1] === "request-certificate") {
          return { exitCode: 0, stdout: JSON.stringify({ CertificateArn: "arn:aws:acm:us-east-1:123:certificate/new" }) };
        }
        if (args[0] === "acm" && args[1] === "describe-certificate") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              Certificate: {
                Status: "ISSUED",
                DomainValidationOptions: [{
                  DomainName: "app.example.com",
                  ResourceRecord: { Name: "_acme.app.example.com.", Type: "CNAME", Value: "_acme.acm-validations.aws." },
                  ValidationStatus: "SUCCESS",
                }],
              },
            }),
          };
        }
        return { exitCode: 0, stdout: "" };
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () =>
        new Response(JSON.stringify({ success: true, result: { id: "rec-1" } }), { status: 200 })
      ) as any;

      try {
        const result = await provider.ensureCertificate("app.example.com", mockCli, {});
        expect(result).toBe("arn:aws:acm:us-east-1:123:certificate/new");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("ensureDnsRecords", () => {
    test("calls Cloudflare API to upsert CNAME", async () => {
      const fetchCalls: { url: string; method: string; body: any }[] = [];
      const originalFetch = globalThis.fetch;

      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        fetchCalls.push({
          url: urlStr,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(init.body as string) : null,
        });

        if (init?.method === "GET" || !init?.method) {
          return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, result: { id: "rec-1" } }), { status: 200 });
      }) as any;

      try {
        await provider.ensureDnsRecords("app.example.com", "d123456.cloudfront.net");

        expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
        const createCall = fetchCalls.find((c) => c.method === "POST");
        expect(createCall).toBeDefined();
        expect(createCall!.body.type).toBe("CNAME");
        expect(createCall!.body.name).toBe("app.example.com");
        expect(createCall!.body.content).toBe("d123456.cloudfront.net");
        expect(createCall!.body.proxied).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
