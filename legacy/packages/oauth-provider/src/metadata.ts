/**
 * OAuth Server Metadata
 *
 * Generate standard metadata documents for OAuth 2.1 server discovery.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414 — Authorization Server Metadata
 * @see https://datatracker.ietf.org/doc/html/rfc9728 — Protected Resource Metadata
 */

import type { AuthServerConfig } from "./types.ts";

// ============================================================================
// Authorization Server Metadata (RFC 8414)
// ============================================================================

/**
 * Generate OAuth 2.1 Authorization Server Metadata.
 *
 * The returned object can be served directly as the JSON body of
 * `GET /.well-known/oauth-authorization-server`.
 *
 * @param config - Authorization server configuration
 * @returns RFC 8414 compliant metadata object
 *
 * @example
 * ```ts
 * app.get("/.well-known/oauth-authorization-server", (c) => {
 *   return c.json(generateAuthServerMetadata(config));
 * });
 * ```
 */
export function generateAuthServerMetadata(config: AuthServerConfig): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    token_endpoint_auth_methods_supported: ["none"],
    grant_types_supported: config.supportedGrantTypes,
    response_types_supported: config.supportedResponseTypes,
    code_challenge_methods_supported: config.codeChallengeMethodsSupported,
    scopes_supported: config.supportedScopes.map((s) => s.name),
  };

  if (config.registrationEndpoint) {
    metadata.registration_endpoint = config.registrationEndpoint;
  }

  return metadata;
}

// ============================================================================
// Protected Resource Metadata (RFC 9728)
// ============================================================================

/**
 * Configuration for protected resource metadata.
 */
export type ProtectedResourceConfig = {
  /** URL of the protected resource */
  resource: string;
  /** Associated authorization server issuer identifiers */
  authorizationServers: string[];
  /** Supported scopes (optional) */
  scopesSupported?: string[];
  /** Supported bearer token methods (default: ["header"]) */
  bearerMethodsSupported?: string[];
};

/**
 * Generate OAuth Protected Resource Metadata.
 *
 * The returned object can be served directly as the JSON body of
 * `GET /.well-known/oauth-protected-resource`.
 *
 * @param config - Protected resource configuration
 * @returns RFC 9728 compliant metadata object
 *
 * @example
 * ```ts
 * app.get("/.well-known/oauth-protected-resource", (c) => {
 *   return c.json(generateProtectedResourceMetadata({
 *     resource: "https://api.example.com/mcp",
 *     authorizationServers: ["https://api.example.com"],
 *   }));
 * });
 * ```
 */
export function generateProtectedResourceMetadata(
  config: ProtectedResourceConfig
): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: config.authorizationServers,
    scopes_supported: config.scopesSupported,
    bearer_methods_supported: config.bearerMethodsSupported ?? ["header"],
  };
}
