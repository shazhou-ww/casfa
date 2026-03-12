import type { CfnFragment } from "./types.js";
import { toPascalCase } from "./types.js";

export interface HttpApiRoute {
  /** Logical id of the Lambda function (e.g. SsoApiFunction) */
  functionLogicalId: string;
}

/**
 * Generate API Gateway HTTP API with integrations to Lambda.
 * One route per backend entry; path stripping: /<cellId>/api -> Lambda receives /api (handled by gateway/integration).
 */
export function generateHttpApi(
  logicalIdPrefix: string,
  apiName: string,
  routes: HttpApiRoute[]
): CfnFragment {
  const resources: Record<string, unknown> = {};

  const apiLogicalId = `${logicalIdPrefix}HttpApi`;
  resources[apiLogicalId] = {
    Type: "AWS::ApiGatewayV2::Api",
    Properties: {
      Name: apiName,
      ProtocolType: "HTTP",
      CorsConfiguration: {
        AllowOrigins: ["*"],
        AllowMethods: ["*"],
        AllowHeaders: ["*"],
      },
    },
  };

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const pascal = toPascalCase(route.functionLogicalId.replace(/Function$/, "") || "Default");
    const integrationId = `${logicalIdPrefix}${pascal}Integration`;
    const routeId = `${logicalIdPrefix}${pascal}Route`;
    const permId = `${logicalIdPrefix}${pascal}LambdaPermission`;

    resources[integrationId] = {
      Type: "AWS::ApiGatewayV2::Integration",
      Properties: {
        ApiId: { Ref: apiLogicalId },
        IntegrationType: "AWS_PROXY",
        IntegrationUri: { "Fn::GetAtt": [route.functionLogicalId, "Arn"] },
        PayloadFormatVersion: "2.0",
      },
    };

    resources[routeId] = {
      Type: "AWS::ApiGatewayV2::Route",
      Properties: {
        ApiId: { Ref: apiLogicalId },
        RouteKey: "$default",
        Target: {
          "Fn::Sub": `integrations/\${${integrationId}}`,
        },
      },
    };

    resources[permId] = {
      Type: "AWS::Lambda::Permission",
      Properties: {
        FunctionName: { Ref: route.functionLogicalId },
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        SourceArn: {
          "Fn::Sub": `arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${${apiLogicalId}}/*`,
        },
      },
    };
  }

  const stageLogicalId = `${logicalIdPrefix}HttpApiStage`;
  resources[stageLogicalId] = {
    Type: "AWS::ApiGatewayV2::Stage",
    Properties: {
      ApiId: { Ref: apiLogicalId },
      StageName: "$default",
      AutoDeploy: true,
    },
  };

  return {
    Resources: resources,
    Outputs: {
      [`${logicalIdPrefix}HttpApiId`]: { Value: { Ref: apiLogicalId } },
      [`${logicalIdPrefix}HttpApiEndpoint`]: {
        Value: {
          "Fn::Sub": `https://\${${apiLogicalId}}.execute-api.\${AWS::Region}.amazonaws.com`,
        },
      },
    },
  };
}
