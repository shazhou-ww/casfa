/**
 * OAuth Dynamic Clients DB
 *
 * Persists dynamically registered OAuth clients (RFC 7591) in DynamoDB.
 * Uses the shared tokensTable with PK = OAUTHCLIENT#{clientId}, SK = METADATA.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type OAuthClientRecord = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: "none";
  createdAt: number;
};

export type OAuthClientsDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

export type OAuthClientsDb = {
  /** Store a new OAuth client. Overwrites if already exists. */
  put: (client: OAuthClientRecord) => Promise<void>;
  /** Get an OAuth client by clientId. Returns null if not found. */
  get: (clientId: string) => Promise<OAuthClientRecord | null>;
};

// ============================================================================
// Factory
// ============================================================================

export const createOAuthClientsDb = (config: OAuthClientsDbConfig): OAuthClientsDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const pk = (clientId: string) => `OAUTHCLIENT#${clientId}`;
  const SK = "METADATA";

  const put = async (record: OAuthClientRecord): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: pk(record.clientId),
          sk: SK,
          ...record,
        },
      })
    );
  };

  const get = async (clientId: string): Promise<OAuthClientRecord | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: pk(clientId), sk: SK },
      })
    );
    if (!result.Item) return null;
    return {
      clientId: result.Item.clientId as string,
      clientName: result.Item.clientName as string,
      redirectUris: result.Item.redirectUris as string[],
      grantTypes: result.Item.grantTypes as string[],
      tokenEndpointAuthMethod: result.Item.tokenEndpointAuthMethod as "none",
      createdAt: result.Item.createdAt as number,
    };
  };

  return { put, get };
};
