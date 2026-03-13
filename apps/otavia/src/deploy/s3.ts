import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

/**
 * Generate S3 bucket fragment (data bucket).
 * AWS::S3::Bucket with PublicAccessBlock.
 */
export function generateBucket(bucketKey: string, bucketName: string): CfnFragment {
  const logicalId = `${toPascalCase(bucketKey)}Bucket`;
  return {
    Resources: {
      [logicalId]: {
        Type: "AWS::S3::Bucket",
        Properties: {
          BucketName: bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      },
    },
    Outputs: {
      [`${logicalId}Name`]: { Value: { Ref: logicalId } },
      [`${logicalId}Arn`]: { Value: { "Fn::GetAtt": [logicalId, "Arn"] } },
    },
  };
}

/**
 * Generate frontend asset bucket (single per stack).
 * Same structure: AWS::S3::Bucket + PublicAccessBlock.
 */
export function generateFrontendBucket(bucketName: string): CfnFragment {
  return {
    Resources: {
      FrontendBucket: {
        Type: "AWS::S3::Bucket",
        Properties: {
          BucketName: bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      },
    },
    Outputs: {
      FrontendBucketName: { Value: { Ref: "FrontendBucket" } },
      FrontendBucketArn: { Value: { "Fn::GetAtt": ["FrontendBucket", "Arn"] } },
    },
  };
}
