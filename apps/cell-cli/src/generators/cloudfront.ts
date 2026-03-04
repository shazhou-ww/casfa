import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { cfnResolveValue } from "./types.js";

const CACHING_DISABLED_POLICY = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const CACHING_OPTIMIZED_POLICY = "658327ea-f89d-4fab-a63d-7e88639e58f6";

const SPA_FALLBACK_CODE = [
  "const AWS = require('aws-sdk');",
  "function parse(d) {",
  "  if (!d || typeof d !== 'string') return null;",
  "  const p = d.toLowerCase().split('.');",
  "  if (p.length >= 4 && p[1] === 's3') return { bucket: p[0], region: p[2] || 'us-east-1' };",
  "  return null;",
  "}",
  "exports.handler = async (event) => {",
  "  const r = event.Records && event.Records[0] && event.Records[0].cf;",
  "  if (!r) return event;",
  "  const req = r.request;",
  "  const res = r.response;",
  "  const status = parseInt(res.status, 10);",
  "  if (status !== 403 && status !== 404) return event;",
  "  if (req.uri.startsWith('/api')) return event;",
  "  const o = parse(req.origin && req.origin.s3 && req.origin.s3.domainName);",
  "  if (!o) return event;",
  "  const s3 = new AWS.S3({ region: o.region });",
  "  try {",
  "    const out = await s3.getObject({ Bucket: o.bucket, Key: 'index.html' }).promise();",
  "    const body = out.Body.toString('utf-8');",
  "    const b64 = Buffer.from(body, 'utf-8').toString('base64');",
  "    res.status = '200';",
  "    res.statusDescription = 'OK';",
  "    res.body = b64;",
  "    res.bodyEncoding = 'base64';",
  "    res.headers['content-type'] = [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }];",
  "    res.headers['content-length'] = [{ key: 'Content-Length', value: String(Buffer.byteLength(body, 'utf-8')) }];",
  "  } catch (e) {}",
  "  return event;",
  "};",
].join("\n");

export function generateCloudFront(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};

  const domainHost = config.domain?.host ?? "";
  const certificateArn = config.domain
    ? cfnResolveValue(config.name, config.domain.certificate)
    : "";

  conditions.UseCustomDomain = {
    "Fn::Not": [{ "Fn::Equals": [domainHost, ""] }],
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

  // API Cache Policy (for /api/*)
  resources.ApiCachePolicy = {
    Type: "AWS::CloudFront::CachePolicy",
    Properties: {
      CachePolicyConfig: {
        Name: `${config.name}-api-cache`,
        Comment:
          "Forward Authorization header to API Gateway; cache key includes Authorization so per-user",
        DefaultTTL: 1,
        MaxTTL: 1,
        MinTTL: 0,
        ParametersInCacheKeyAndForwardedToOrigin: {
          EnableAcceptEncodingGzip: true,
          HeadersConfig: {
            HeaderBehavior: "whitelist",
            Headers: ["Authorization"],
          },
          CookiesConfig: { CookieBehavior: "none" },
          QueryStringsConfig: { QueryStringBehavior: "all" },
        },
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
              "Fn::Sub":
                "${HttpApi}.execute-api.${AWS::Region}.amazonaws.com",
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
        },
        CacheBehaviors: [
          {
            PathPattern: "/oauth/callback",
            TargetOriginId: "ApiGateway",
            ViewerProtocolPolicy: "https-only",
            AllowedMethods: ["GET", "HEAD", "OPTIONS"],
            Compress: true,
            CachePolicyId: CACHING_DISABLED_POLICY,
          },
          {
            PathPattern: "/api/*",
            TargetOriginId: "ApiGateway",
            ViewerProtocolPolicy: "https-only",
            AllowedMethods: [
              "GET",
              "HEAD",
              "OPTIONS",
              "PUT",
              "POST",
              "PATCH",
              "DELETE",
            ],
            Compress: true,
            CachePolicyId: { Ref: "ApiCachePolicy" },
          },
        ],
        Aliases: {
          "Fn::If": [
            "UseCustomDomain",
            [domainHost],
            { Ref: "AWS::NoValue" },
          ],
        },
        ViewerCertificate: {
          "Fn::If": [
            "UseCustomDomain",
            {
              AcmCertificateArn: certificateArn,
              SslSupportMethod: "sni-only",
              MinimumProtocolVersion: "TLSv1.2_2021",
            },
            { CloudFrontDefaultCertificate: true },
          ],
        },
      },
    },
  };

  // SPA Fallback Lambda@Edge (not attached to distribution — caused 503)
  resources.SpaFallbackEdgeRole = {
    Type: "AWS::IAM::Role",
    Properties: {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
          {
            Effect: "Allow",
            Principal: { Service: "edgelambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      },
    },
  };

  resources.SpaFallbackEdgeRolePolicy = {
    Type: "AWS::IAM::Policy",
    Properties: {
      PolicyName: "SpaFallbackEdgeS3",
      Roles: [{ Ref: "SpaFallbackEdgeRole" }],
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "s3:GetObject",
            Resource: { "Fn::Sub": "${FrontendBucket.Arn}/index.html" },
          },
        ],
      },
    },
  };

  resources.SpaFallbackEdgeFunction = {
    Type: "AWS::Lambda::Function",
    Properties: {
      Runtime: "nodejs18.x",
      Handler: "index.handler",
      Code: { ZipFile: SPA_FALLBACK_CODE },
      Role: { "Fn::GetAtt": ["SpaFallbackEdgeRole", "Arn"] },
      MemorySize: 128,
      Timeout: 5,
    },
  };

  resources.SpaFallbackEdgeVersion = {
    Type: "AWS::Lambda::Version",
    DependsOn: "SpaFallbackEdgeFunction",
    Properties: {
      FunctionName: { Ref: "SpaFallbackEdgeFunction" },
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
