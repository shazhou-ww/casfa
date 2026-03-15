import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { streamHandle } from "hono/aws-lambda";
import { app } from "./dev-app.ts";

export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEventV2,
    responseStream: NodeJS.WritableStream,
    context: unknown
  ): Promise<void> => {
    await streamHandle(app)(event, responseStream, context as never);
  }
);

export type LambdaResult = APIGatewayProxyStructuredResultV2;
