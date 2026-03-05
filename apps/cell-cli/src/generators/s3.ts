import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

export function generateS3(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};

  // No DeletionPolicy: Retain so rollback/stack-delete removes resources (no orphan buckets).
  for (const bucket of config.buckets) {
    const logicalId = `${toPascalCase(bucket.key)}Bucket`;
    resources[logicalId] = {
      Type: "AWS::S3::Bucket",
      Properties: {
        BucketName: bucket.bucketName,
      },
    };
    outputs[`${logicalId}Name`] = {
      Value: { Ref: logicalId },
    };
    outputs[`${logicalId}Arn`] = {
      Value: { "Fn::GetAtt": [logicalId, "Arn"] },
    };
  }

  resources.FrontendBucket = {
    Type: "AWS::S3::Bucket",
    Properties: {
      BucketName: config.frontendBucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    },
  };

  outputs.FrontendBucketName = {
    Value: { Ref: "FrontendBucket" },
  };
  outputs.FrontendBucketArn = {
    Value: { "Fn::GetAtt": ["FrontendBucket", "Arn"] },
  };

  return { Resources: resources, Outputs: outputs };
}
