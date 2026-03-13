/**
 * Generate CloudFront distribution: single domain, path behaviors per cell.
 * Reference: cell-cli cloudfront.ts generateCloudFrontPlatform.
 */

const CACHING_DISABLED_POLICY = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const CACHING_OPTIMIZED_POLICY = "658327ea-f89d-4fab-a63d-7e88639e58f6";

export interface GenerateCloudFrontOptions {
  domainHost: string;
  defaultOriginId: string;
  /** Root path ("/") should redirect to /<mount>/ when set. */
  defaultCellMount?: string;
  /** S3 frontend bucket ref - used for default origin */
  frontendBucketRef?: string;
  /** Path behaviors: pathPattern (e.g. /sso/*) -> originId. API origins use originId as Api Ref. */
  pathBehaviors: Array<{ pathPattern: string; originId: string; isApi?: boolean }>;
  hostedZoneId?: string;
  certificateArn?: string;
  stackName: string;
}

import type { CfnFragment } from "./types.js";

export function generateCloudFrontDistribution(options: GenerateCloudFrontOptions): CfnFragment {
  const {
    domainHost,
    defaultOriginId,
    defaultCellMount,
    frontendBucketRef = "FrontendBucket",
    pathBehaviors,
    hostedZoneId,
    certificateArn,
    stackName,
  } = options;

  const resources: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};
  const rootRedirectPath = defaultCellMount ? `/${defaultCellMount}/` : "/";
  const rootIndexPath = defaultCellMount ? `/${defaultCellMount}/index.html` : "/index.html";

  const autoCert = !certificateArn && !!domainHost && !!hostedZoneId;
  let certificateRef: unknown;
  if (autoCert) {
    resources.AcmCertificate = {
      Type: "AWS::CertificateManager::Certificate",
      Properties: {
        DomainName: domainHost,
        ValidationMethod: "DNS",
        DomainValidationOptions: [{ DomainName: domainHost, HostedZoneId: hostedZoneId }],
      },
    };
    certificateRef = { Ref: "AcmCertificate" };
  } else if (certificateArn) {
    certificateRef = certificateArn;
  }

  const useCustomDomain = !!domainHost && (autoCert || !!certificateArn);
  conditions.UseCustomDomain = {
    "Fn::Not": [{ "Fn::Equals": [useCustomDomain ? domainHost : "", ""] }],
  };

  resources.FrontendOAC = {
    Type: "AWS::CloudFront::OriginAccessControl",
    Properties: {
      OriginAccessControlConfig: {
        Name: `${stackName}-frontend-oac`,
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    },
  };

  resources.SpaRewriteFunction = {
    Type: "AWS::CloudFront::Function",
    Properties: {
      Name: `${stackName}-spa-rewrite`,
      AutoPublish: true,
      FunctionCode: [
        "function handler(event) {",
        "  var uri = event.request.uri;",
        `  var rootRedirectPath = ${JSON.stringify(rootRedirectPath)};`,
        `  var rootIndexPath = ${JSON.stringify(rootIndexPath)};`,
        "  if (uri === '/') {",
        "    return {",
        "      statusCode: 302,",
        "      statusDescription: 'Found',",
        "      headers: {",
        "        location: { value: rootRedirectPath }",
        "      }",
        "    };",
        "  } else if (uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {",
        "    var parts = uri.split('/').filter(Boolean);",
        "    if (parts.length > 0) {",
        "      event.request.uri = '/' + parts[0] + '/index.html';",
        "    } else {",
        "      event.request.uri = rootIndexPath;",
        "    }",
        "  }",
        "  return event.request;",
        "}",
      ].join("\n"),
      FunctionConfig: {
        Comment: "SPA fallback",
        Runtime: "cloudfront-js-2.0",
      },
    },
  };

  const origins: unknown[] = [
    {
      Id: defaultOriginId,
      DomainName: { "Fn::GetAtt": [frontendBucketRef, "RegionalDomainName"] },
      OriginAccessControlId: { "Fn::GetAtt": ["FrontendOAC", "Id"] },
      S3OriginConfig: { OriginAccessIdentity: "" },
    },
  ];

  const seenApiOrigins = new Set<string>();
  for (const b of pathBehaviors) {
    if (b.isApi && !seenApiOrigins.has(b.originId)) {
      seenApiOrigins.add(b.originId);
      origins.push({
        Id: b.originId,
        DomainName: {
          "Fn::Sub": `\${${b.originId}}.execute-api.\${AWS::Region}.amazonaws.com`,
        },
        CustomOriginConfig: {
          HTTPSPort: 443,
          OriginProtocolPolicy: "https-only",
        },
      });
    }
  }

  const cacheBehaviors = pathBehaviors.map((b) => ({
    PathPattern: b.pathPattern,
    TargetOriginId: b.originId,
    ViewerProtocolPolicy: "https-only" as const,
    AllowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
    Compress: true,
    CachePolicyId: CACHING_DISABLED_POLICY,
    OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
  }));

  resources.FrontendCloudFront = {
    Type: "AWS::CloudFront::Distribution",
    Properties: {
      DistributionConfig: {
        Enabled: true,
        DefaultRootObject: "index.html",
        Origins: origins,
        DefaultCacheBehavior: {
          TargetOriginId: defaultOriginId,
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
        CacheBehaviors: cacheBehaviors,
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

  resources.FrontendBucketPolicy = {
    Type: "AWS::S3::BucketPolicy",
    DependsOn: "FrontendCloudFront",
    Properties: {
      Bucket: { Ref: frontendBucketRef },
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowCloudFrontOAC",
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: { "Fn::Sub": `\${${frontendBucketRef}.Arn}/*` },
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

  return {
    Resources: resources,
    Outputs: {
      FrontendUrl: {
        Description: "CloudFront URL",
        Value: { "Fn::Sub": "https://${FrontendCloudFront.DomainName}" },
      },
      FrontendDistributionId: {
        Description: "CloudFront distribution ID",
        Value: { Ref: "FrontendCloudFront" },
      },
    },
    Conditions: conditions,
  };
}
