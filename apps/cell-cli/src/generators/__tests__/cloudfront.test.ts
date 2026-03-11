import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateCloudFront } from "../cloudfront.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    name: "test-app",
    envVars: {},
    secretRefs: {},
    tables: [],
    buckets: [],
    frontendBucketName: "test-app-frontend",
    backend: {
      runtime: "nodejs20.x",
      entries: {
        api: {
          handler: "backend/handler.ts",
          timeout: 30,
          memory: 512,
          routes: ["/api/*", "/oauth/callback"],
        },
      },
    },
    ...overrides,
  };
}

describe("generateCloudFront", () => {
  test("distribution has S3 + API Gateway origins", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const origins = dist.Properties.DistributionConfig.Origins;
    expect(origins).toHaveLength(2);
    expect(origins[0].Id).toBe("S3Frontend");
    expect(origins[1].Id).toBe("ApiGateway");
  });

  test("default behavior targets S3Frontend", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const defaultBehavior = dist.Properties.DistributionConfig.DefaultCacheBehavior;
    expect(defaultBehavior.TargetOriginId).toBe("S3Frontend");
    expect(defaultBehavior.ViewerProtocolPolicy).toBe("redirect-to-https");
  });

  test("backend routes generate API cache behaviors", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const behaviors = dist.Properties.DistributionConfig.CacheBehaviors;
    expect(behaviors).toHaveLength(2);

    const apiBehavior = behaviors.find((b: any) => b.PathPattern === "/api/*");
    expect(apiBehavior.TargetOriginId).toBe("ApiGateway");
    expect(apiBehavior.AllowedMethods).toContain("POST");
    expect(apiBehavior.AllowedMethods).toContain("DELETE");

    const oauthBehavior = behaviors.find((b: any) => b.PathPattern === "/oauth/callback");
    expect(oauthBehavior.TargetOriginId).toBe("ApiGateway");
    expect(oauthBehavior.AllowedMethods).toContain("POST");
  });

  test("OAC generated", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const oac = result.Resources.FrontendOAC as any;
    expect(oac.Type).toBe("AWS::CloudFront::OriginAccessControl");
    expect(oac.Properties.OriginAccessControlConfig.SigningBehavior).toBe("always");
    expect(oac.Properties.OriginAccessControlConfig.SigningProtocol).toBe("sigv4");
  });

  test("custom domain with ACM cert (conditional)", () => {
    const config = makeConfig({
      domain: {
        alias: "app",
        zone: "example.com",
        host: "app.example.com",
        subdomain: "app",
        certificate: "arn:aws:acm:us-east-1:123:certificate/abc",
      },
    });
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const aliases = dist.Properties.DistributionConfig.Aliases;
    expect(aliases["Fn::If"][0]).toBe("UseCustomDomain");
    expect(aliases["Fn::If"][1]).toContain("app.example.com");

    const cert = dist.Properties.DistributionConfig.ViewerCertificate;
    expect(cert["Fn::If"][1].AcmCertificateArn).toBe("arn:aws:acm:us-east-1:123:certificate/abc");
    expect(cert["Fn::If"][1].SslSupportMethod).toBe("sni-only");
  });

  test("no domain → CloudFrontDefaultCertificate", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const cert = dist.Properties.DistributionConfig.ViewerCertificate;
    expect(cert["Fn::If"][2]).toEqual({ CloudFrontDefaultCertificate: true });
  });

  test("frontend bucket policy references CloudFront distribution", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const policy = result.Resources.FrontendBucketPolicy as any;
    expect(policy.Type).toBe("AWS::S3::BucketPolicy");
    expect(policy.DependsOn).toBe("FrontendCloudFront");
    const statement = policy.Properties.PolicyDocument.Statement[0];
    expect(statement.Condition.StringEquals["AWS:SourceArn"]["Fn::Sub"]).toContain(
      "FrontendCloudFront"
    );
  });

  test("external cert ARN (Cloudflare flow) uses cert directly, no AcmCertificate resource", () => {
    const config = makeConfig({
      domain: {
        alias: "app",
        zone: "example.com",
        host: "app.example.com",
        subdomain: "app",
        dns: "cloudflare",
        certificate: "arn:aws:acm:us-east-1:123:certificate/external",
        cloudflare: { zoneId: "zone123", apiToken: "token" },
      },
    });
    const result = generateCloudFront(config);

    // Should NOT create AcmCertificate resource
    expect(result.Resources.AcmCertificate).toBeUndefined();

    // Should use the provided cert ARN
    const dist = result.Resources.FrontendCloudFront as any;
    const cert = dist.Properties.DistributionConfig.ViewerCertificate;
    expect(cert["Fn::If"][1].AcmCertificateArn).toBe(
      "arn:aws:acm:us-east-1:123:certificate/external"
    );
  });
});
