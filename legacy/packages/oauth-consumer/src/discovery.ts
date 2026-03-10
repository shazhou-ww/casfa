/**
 * OIDC Discovery
 *
 * Fetches and parses the OpenID Connect Discovery document
 * to automatically configure IdP endpoints.
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html
 */

import type { IdpConfig, Result } from "./types.ts";

/**
 * Expected shape of the OIDC Discovery document.
 * Only the fields we need are listed.
 */
type OidcDiscoveryDocument = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  [key: string]: unknown;
};

/**
 * Discover IdP configuration from an OIDC Discovery URL.
 *
 * Fetches `{discoveryUrl}` (typically ending in `/.well-known/openid-configuration`),
 * parses the JSON response, and constructs an {@link IdpConfig}.
 *
 * @param discoveryUrl - Full URL to the OIDC discovery document
 * @param clientId - OAuth client_id to include in the config
 * @param clientSecret - OAuth client_secret (omit for public clients)
 * @returns Fully populated IdpConfig, or an error
 *
 * @example
 * ```ts
 * const result = await discoverIdpConfig(
 *   "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx/.well-known/openid-configuration",
 *   "my-client-id"
 * );
 * if (result.ok) {
 *   console.log(result.value.tokenEndpoint);
 * }
 * ```
 */
export async function discoverIdpConfig(
  discoveryUrl: string,
  clientId: string,
  clientSecret?: string
): Promise<Result<IdpConfig>> {
  let response: Response;
  try {
    response = await fetch(discoveryUrl);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "discovery_failed",
        message: `Failed to fetch discovery document: ${err instanceof Error ? err.message : String(err)}`,
        statusCode: 502,
      },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: "discovery_failed",
        message: `Discovery endpoint returned HTTP ${response.status}`,
        statusCode: 502,
      },
    };
  }

  let doc: OidcDiscoveryDocument;
  try {
    doc = (await response.json()) as OidcDiscoveryDocument;
  } catch {
    return {
      ok: false,
      error: {
        code: "discovery_failed",
        message: "Discovery document is not valid JSON",
        statusCode: 502,
      },
    };
  }

  // Validate required fields
  const missing: string[] = [];
  if (!doc.issuer) missing.push("issuer");
  if (!doc.authorization_endpoint) missing.push("authorization_endpoint");
  if (!doc.token_endpoint) missing.push("token_endpoint");
  if (!doc.jwks_uri) missing.push("jwks_uri");

  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: "discovery_failed",
        message: `Discovery document missing required fields: ${missing.join(", ")}`,
        statusCode: 502,
      },
    };
  }

  return {
    ok: true,
    value: {
      issuer: doc.issuer,
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      jwksUri: doc.jwks_uri,
      clientId,
      clientSecret,
    },
  };
}
