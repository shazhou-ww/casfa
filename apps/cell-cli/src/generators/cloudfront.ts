import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { cfnResolveValue } from "./types.js";

const CACHING_DISABLED_POLICY = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const CACHING_OPTIMIZED_POLICY = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

const ALL_METHODS = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"];

function buildApiCacheBehaviors(config: ResolvedConfig): unknown[] {
  if (!config.backend) return [];

  const allRoutes = new Set<string>();
  for (const entry of Object.values(config.backend.entries)) {
    for (const route of entry.routes) {
      allRoutes.add(route);
    }
  }

  return [...allRoutes].map((route) => ({
    PathPattern: route,
    TargetOriginId: "ApiGateway",
    ViewerProtocolPolicy: "https-only",
    AllowedMethods: [...ALL_METHODS],
    Compress: true,
    CachePolicyId: CACHING_DISABLED_POLICY,
    OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST,
  }));
}

export function generateCloudFront(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};

  const domainHost = config.domain?.host ?? "";
  const hasExplicitCert = config.domain?.certificate != null;
  const autoCert = !hasExplicitCert && !!domainHost && !!config.domain?.hostedZoneId;

  let certificateRef: unknown;
  if (autoCert) {
    resources.AcmCertificate = {
      Type: "AWS::CertificateManager::Certificate",
      Properties: {
        DomainName: domainHost,
        ValidationMethod: "DNS",
        DomainValidationOptions: [
          {
            DomainName: domainHost,
            HostedZoneId: config.domain!.hostedZoneId,
          },
        ],
      },
    };
    certificateRef = { Ref: "AcmCertificate" };
  } else if (hasExplicitCert) {
    certificateRef = cfnResolveValue(config.name, config.domain!.certificate!);
  }

  const useCustomDomain = !!domainHost && (autoCert || hasExplicitCert);

  conditions.UseCustomDomain = {
    "Fn::Not": [{ "Fn::Equals": [useCustomDomain ? domainHost : "", ""] }],
  };

  // OAC
  resources.FrontendOAC = {
    Type: "AWS::CloudFront::OriginAccessControl",
    Properties: {
      OriginAccessControlConfig: {
        Name: `${config.name}-frontend-oac`,
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    },
  };

  // SPA URL rewrite: non-file paths → /index.html (viewer-request)
  resources.SpaRewriteFunction = {
    Type: "AWS::CloudFront::Function",
    Properties: {
      Name: `${config.name}-spa-rewrite`,
      AutoPublish: true,
      FunctionCode: [
        "function handler(event) {",
        "  var uri = event.request.uri;",
        "  if (uri !== '/' && uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {",
        "    event.request.uri = '/index.html';",
        "  }",
        "  return event.request;",
        "}",
      ].join("\n"),
      FunctionConfig: {
        Comment: "SPA fallback: rewrite non-file paths to /index.html",
        Runtime: "cloudfront-js-2.0",
      },
    },
  };

  // CloudFront Distribution
  resources.FrontendCloudFront = {
    Type: "AWS::CloudFront::Distribution",
    Properties: {
      DistributionConfig: {
        Enabled: true,
        DefaultRootObject: "index.html",
        Origins: [
          {
            Id: "S3Frontend",
            DomainName: {
              "Fn::GetAtt": ["FrontendBucket", "RegionalDomainName"],
            },
            OriginAccessControlId: {
              "Fn::GetAtt": ["FrontendOAC", "Id"],
            },
            S3OriginConfig: { OriginAccessIdentity: "" },
          },
          {
            Id: "ApiGateway",
            DomainName: {
              "Fn::Sub": "${HttpApi}.execute-api.${AWS::Region}.amazonaws.com",
            },
            CustomOriginConfig: {
              HTTPSPort: 443,
              OriginProtocolPolicy: "https-only",
            },
          },
        ],
        DefaultCacheBehavior: {
          TargetOriginId: "S3Frontend",
          ViewerProtocolPolicy: "redirect-to-https",
          AllowedMethods: ["GET", "HEAD", "OPTIONS"],
          Compress: true,
          CachePolicyId: CACHING_OPTIMIZED_POLICY,
          FunctionAssociations: [
            {
              EventType: "viewer-request",
              FunctionARN: { "Fn::GetAtt": ["SpaRewriteFunction", "FunctionARN"] },
            },
          ],
        },
        CacheBehaviors: buildApiCacheBehaviors(config),
        Aliases: {
          "Fn::If": ["UseCustomDomain", [domainHost], { Ref: "AWS::NoValue" }],
        },
        ViewerCertificate: {
          "Fn::If": [
            "UseCustomDomain",
            {
              AcmCertificateArn: certificateRef,
              SslSupportMethod: "sni-only",
              MinimumProtocolVersion: "TLSv1.2_2021",
            },
            { CloudFrontDefaultCertificate: true },
          ],
        },
      },
    },
  };

  // Frontend Bucket Policy
  resources.FrontendBucketPolicy = {
    Type: "AWS::S3::BucketPolicy",
    DependsOn: "FrontendCloudFront",
    Properties: {
      Bucket: { Ref: "FrontendBucket" },
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowCloudFrontOAC",
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: { "Fn::Sub": "${FrontendBucket.Arn}/*" },
            Condition: {
              StringEquals: {
                "AWS:SourceArn": {
                  "Fn::Sub":
                    "arn:aws:cloudfront::${AWS::AccountId}:distribution/${FrontendCloudFront}",
                },
              },
            },
          },
        ],
      },
    },
  };

  outputs.FrontendUrl = {
    Description: "CloudFront URL for frontend",
    Value: { "Fn::Sub": "https://${FrontendCloudFront.DomainName}" },
  };
  outputs.FrontendBucketName = {
    Description: "S3 bucket for frontend assets",
    Value: { Ref: "FrontendBucket" },
  };
  outputs.FrontendDistributionId = {
    Description: "CloudFront distribution ID (for cache invalidation)",
    Value: { Ref: "FrontendCloudFront" },
  };

  return { Resources: resources, Outputs: outputs, Conditions: conditions };
}
