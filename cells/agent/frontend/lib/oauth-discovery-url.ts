/**
 * Build RFC 8414 OAuth Authorization Server Metadata URL from issuer URL.
 * For path issuers, metadata lives at origin-level .well-known with issuer path suffix.
 */
export function buildOAuthAuthorizationServerMetadataUrl(issuerUrl: string): string {
  const issuer = new URL(issuerUrl);
  const origin = issuer.origin.replace(/\/$/, "");
  const path = issuer.pathname.replace(/\/+$/, "");
  if (!path || path === "/") {
    return `${origin}/.well-known/oauth-authorization-server`;
  }
  return `${origin}/.well-known/oauth-authorization-server${path}`;
}

