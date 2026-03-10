/**
 * DynamoDB client factory
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

type ClientConfig = {
  endpoint?: string;
  region?: string;
};

let sharedClient: DynamoDBClient | null = null;

/**
 * Create or return shared DynamoDB client
 */
export const createDynamoClient = (config: ClientConfig = {}): DynamoDBClient => {
  if (sharedClient) return sharedClient;

  const endpoint = config.endpoint ?? process.env.DYNAMODB_ENDPOINT;
  const region = config.region ?? process.env.AWS_REGION ?? "us-east-1";

  const clientConfig = endpoint
    ? {
        region,
        endpoint,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
        },
      }
    : { region };

  sharedClient = new DynamoDBClient(clientConfig);
  return sharedClient;
};

/**
 * Create a DynamoDB Document client
 */
export const createDocClient = (config: ClientConfig = {}): DynamoDBDocumentClient => {
  const client = createDynamoClient(config);
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
};

/**
 * Reset the shared client (for testing)
 */
export const resetClient = () => {
  sharedClient = null;
};
