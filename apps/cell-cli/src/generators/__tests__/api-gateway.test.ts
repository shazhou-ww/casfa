import { describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../../config/resolve-config.js";
import { generateApiGateway } from "../api-gateway.js";

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

const defaultBackend = {
  runtime: "nodejs20.x",
  entries: {
    api: {
      handler: "src/lambda.ts",
      timeout: 30,
      memory: 1024,
      routes: ["*"],
    },
  },
};

describe("generateApiGateway", () => {
  test("HTTP API with CORS", () => {
    const config = makeConfig({ backend: defaultBackend });
    const result = generateApiGateway(config);
    const api = result.Resources.HttpApi as any;
    expect(api.Type).toBe("AWS::ApiGatewayV2::Api");
    expect(api.Properties.ProtocolType).toBe("HTTP");
    expect(api.Properties.CorsConfiguration).toEqual({
      AllowOrigins: ["*"],
      AllowMethods: ["*"],
      AllowHeaders: ["*"],
    });
  });

  test("Lambda integration", () => {
    const config = makeConfig({ backend: defaultBackend });
    const result = generateApiGateway(config);
    const integration = result.Resources.ApiIntegration as any;
    expect(integration.Type).toBe("AWS::ApiGatewayV2::Integration");
    expect(integration.Properties.IntegrationType).toBe("AWS_PROXY");
    expect(integration.Properties.PayloadFormatVersion).toBe("2.0");
  });

  test("catch-all route", () => {
    const config = makeConfig({ backend: defaultBackend });
    const result = generateApiGateway(config);
    const route = result.Resources.ApiRoute as any;
    expect(route.Type).toBe("AWS::ApiGatewayV2::Route");
    expect(route.Properties.RouteKey).toBe("$default");
  });

  test("Lambda permission", () => {
    const config = makeConfig({ backend: defaultBackend });
    const result = generateApiGateway(config);
    const permission = result.Resources.ApiLambdaPermission as any;
    expect(permission.Type).toBe("AWS::Lambda::Permission");
    expect(permission.Properties.Principal).toBe("apigateway.amazonaws.com");
  });
});
