import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

export function generateLambda(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};

  if (!config.backend) return { Resources: resources };

  const envVariables: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.envVars)) {
    if (key in config.secretRefs) {
      envVariables[key] = `{{resolve:secretsmanager:${config.name}/${config.secretRefs[key]}}}`;
    } else {
      envVariables[key] = value;
    }
  }

  const useVpc = config.network?.vpc === true;

  for (const [key, entry] of Object.entries(config.backend.entries)) {
    const logicalId = `${toPascalCase(key)}Function`;
    const functionProps: Record<string, unknown> = {
      Runtime: config.backend.runtime,
      Handler: "index.handler",
      Code: { S3Bucket: "PLACEHOLDER", S3Key: `build/${key}/code.zip` },
      Timeout: entry.timeout,
      MemorySize: entry.memory,
      Role: { "Fn::GetAtt": ["LambdaExecutionRole", "Arn"] },
      Environment: { Variables: envVariables },
    };
    if (useVpc) {
      functionProps.VpcConfig = {
        SubnetIds: [{ Ref: "PrivateSubnetA" }, { Ref: "PrivateSubnetB" }],
        SecurityGroupIds: [{ Ref: "LambdaSecurityGroup" }],
      };
    }
    resources[logicalId] = {
      Type: "AWS::Lambda::Function",
      Properties: functionProps,
    };
  }

  const policyStatements: unknown[] = [];

  if (config.tables.length > 0) {
    const tableResources: unknown[] = [];
    for (const table of config.tables) {
      const logicalId = `${toPascalCase(table.key)}Table`;
      tableResources.push({ "Fn::GetAtt": [logicalId, "Arn"] });
      tableResources.push({ "Fn::Sub": `\${${logicalId}.Arn}/index/*` });
    }
    policyStatements.push({
      Effect: "Allow",
      Action: [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:Scan",
      ],
      Resource: tableResources,
    });
  }

  if (config.buckets.length > 0) {
    const bucketResources: unknown[] = [];
    for (const bucket of config.buckets) {
      const logicalId = `${toPascalCase(bucket.key)}Bucket`;
      bucketResources.push({ "Fn::GetAtt": [logicalId, "Arn"] });
      bucketResources.push({ "Fn::Sub": `\${${logicalId}.Arn}/*` });
    }
    policyStatements.push({
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      Resource: bucketResources,
    });
  }

  policyStatements.push({
    Effect: "Allow",
    Action: "s3:GetObject",
    Resource: { "Fn::Sub": "${FrontendBucket.Arn}/index.html" },
  });

  resources.LambdaExecutionRole = {
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
        ],
      },
      ManagedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ...(useVpc
          ? ["arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"]
          : []),
      ],
      Policies: [
        {
          PolicyName: "LambdaPolicy",
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: policyStatements,
          },
        },
      ],
    },
  };

  return { Resources: resources, Outputs: outputs };
}
