import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

export function generateApiGateway(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};

  if (!config.backend) return { Resources: resources };

  resources.HttpApi = {
    Type: "AWS::ApiGatewayV2::Api",
    Properties: {
      Name: `${config.name}-api`,
      ProtocolType: "HTTP",
      CorsConfiguration: {
        AllowOrigins: ["*"],
        AllowMethods: ["*"],
        AllowHeaders: ["*"],
      },
    },
  };

  for (const [key] of Object.entries(config.backend.entries)) {
    const pascal = toPascalCase(key);

    resources[`${pascal}Integration`] = {
      Type: "AWS::ApiGatewayV2::Integration",
      Properties: {
        ApiId: { Ref: "HttpApi" },
        IntegrationType: "AWS_PROXY",
        IntegrationUri: { "Fn::GetAtt": [`${pascal}Function`, "Arn"] },
        PayloadFormatVersion: "2.0",
      },
    };

    resources[`${pascal}Route`] = {
      Type: "AWS::ApiGatewayV2::Route",
      Properties: {
        ApiId: { Ref: "HttpApi" },
        RouteKey: "$default",
        Target: {
          "Fn::Sub": `integrations/\${${pascal}Integration}`,
        },
      },
    };

    resources[`${pascal}LambdaPermission`] = {
      Type: "AWS::Lambda::Permission",
      Properties: {
        FunctionName: { Ref: `${pascal}Function` },
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        SourceArn: {
          "Fn::Sub":
            "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*",
        },
      },
    };
  }

  resources.HttpApiStage = {
    Type: "AWS::ApiGatewayV2::Stage",
    Properties: {
      ApiId: { Ref: "HttpApi" },
      StageName: "$default",
      AutoDeploy: true,
    },
  };

  outputs.HttpApiId = {
    Value: { Ref: "HttpApi" },
  };
  outputs.HttpApiEndpoint = {
    Value: {
      "Fn::Sub":
        "https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com",
    },
  };

  return { Resources: resources, Outputs: outputs };
}
