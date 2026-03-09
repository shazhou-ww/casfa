/**
 * MCP server config and discovery types.
 * Stored in settings under key "mcp.servers"; tokens stored only in IndexedDB (frontend).
 */

export type MCPServerTransport = "stdio" | "http";

export type MCPServerAuth = "none" | "oauth2";

export type MCPServerConfig = {
  id: string;
  name: string;
  transport: MCPServerTransport;
  /** HTTP endpoint URL when transport is "http" */
  url?: string;
  auth: MCPServerAuth;
  /** Pre-registered client_id when auth is oauth2 */
  oauthClientId?: string;
  /** Client ID Metadata Document URL when using OAuth Client ID Metadata (client_id is this URL) */
  oauthClientMetadataUrl?: string;
};

export type MCPTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  title?: string;
};

export type MCPPrompt = {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
};

export type MCPResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export type MCPServerDiscovery = {
  serverId: string;
  tools: MCPTool[];
  prompts: MCPPrompt[];
  resources: MCPResource[];
  error?: string;
  updatedAt: number;
};

/** OAuth: Protected Resource Metadata (RFC 9728) */
export type OAuthProtectedResourceMetadata = {
  authorization_servers?: string[];
  resource?: string;
  scopes_supported?: string[];
  [key: string]: unknown;
};

/** OAuth: Authorization Server Metadata (RFC 8414) */
export type OAuthAuthorizationServerMetadata = {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  [key: string]: unknown;
};

export const MCP_SERVERS_SETTINGS_KEY = "mcp.servers";

export function parseMcpServers(value: unknown): MCPServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MCPServerConfig =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as MCPServerConfig).id === "string" &&
      typeof (item as MCPServerConfig).name === "string" &&
      ((item as MCPServerConfig).transport === "stdio" || (item as MCPServerConfig).transport === "http") &&
      ((item as MCPServerConfig).auth === "none" || (item as MCPServerConfig).auth === "oauth2")
  );
}
