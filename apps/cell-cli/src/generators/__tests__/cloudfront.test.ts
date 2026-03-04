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

  test("/api/* behavior targets ApiGateway with auth header forwarding", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const apiBehavior = dist.Properties.DistributionConfig.CacheBehaviors.find(
      (b: any) => b.PathPattern === "/api/*",
    );
    expect(apiBehavior.TargetOriginId).toBe("ApiGateway");
    expect(apiBehavior.AllowedMethods).toContain("POST");
    expect(apiBehavior.CachePolicyId).toEqual({ Ref: "ApiCachePolicy" });

    const cachePolicy = result.Resources.ApiCachePolicy as any;
    const headers =
      cachePolicy.Properties.CachePolicyConfig
        .ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig;
    expect(headers.Headers).toContain("Authorization");
  });

  test("OAC generated", () => {
    const config = makeConfig();
    const result = generateCloudFront(config);
    const oac = result.Resources.FrontendOAC as any;
    expect(oac.Type).toBe("AWS::CloudFront::OriginAccessControl");
    expect(oac.Properties.OriginAccessControlConfig.SigningBehavior).toBe(
      "always",
    );
    expect(oac.Properties.OriginAccessControlConfig.SigningProtocol).toBe(
      "sigv4",
    );
  });

  test("custom domain with ACM cert (conditional)", () => {
    const config = makeConfig({
      domain: {
        zone: "example.com",
        host: "app.example.com",
        certificate: "arn:aws:acm:us-east-1:123:certificate/abc",
      },
    });
    const result = generateCloudFront(config);
    const dist = result.Resources.FrontendCloudFront as any;
    const aliases = dist.Properties.DistributionConfig.Aliases;
    expect(aliases["Fn::If"][0]).toBe("UseCustomDomain");
    expect(aliases["Fn::If"][1]).toContain("app.example.com");

    const cert = dist.Properties.DistributionConfig.ViewerCertificate;
    expect(cert["Fn::If"][1].AcmCertificateArn).toBe(
      "arn:aws:acm:us-east-1:123:certificate/abc",
    );
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
      "FrontendCloudFront",
    );
  });
});
