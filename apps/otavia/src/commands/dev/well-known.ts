import type { Context } from "hono";
import type { CellConfig } from "../../config/cell-yaml-schema.js";

const AUTHORIZATION_SERVER_WELL_KNOWN_PREFIX = "/.well-known/oauth-authorization-server";
const PROTECTED_RESOURCE_WELL_KNOWN_PREFIX = "/.well-known/oauth-protected-resource";

type OAuthEnabledCell = {
  mount: string;
  config: CellConfig;
};

export function extractMountFromAuthorizationServerWellKnownPath(pathname: string): string | null {
  if (pathname === AUTHORIZATION_SERVER_WELL_KNOWN_PREFIX) return null;
  if (!pathname.startsWith(`${AUTHORIZATION_SERVER_WELL_KNOWN_PREFIX}/`)) return null;
  const suffix = pathname.slice(`${AUTHORIZATION_SERVER_WELL_KNOWN_PREFIX}/`.length).replace(/\/+$/, "");
  if (!suffix || suffix.includes("/")) return null;
  return suffix;
}

export function createOAuthDiscoveryRegistry(cells: OAuthEnabledCell[]): Map<string, { scopes: string[] }> {
  const registry = new Map<string, { scopes: string[] }>();
  for (const cell of cells) {
    const oauth = cell.config.oauth;
    if (!oauth?.enabled) continue;
    registry.set(cell.mount, { scopes: oauth.scopes });
  }
  return registry;
}

export function getRequestOrigin(c: Context): string {
  const forwardedHost = c.req.header("X-Forwarded-Host");
  const forwardedProto = c.req.header("X-Forwarded-Proto");
  if (forwardedHost) {
    const proto = forwardedProto ?? (forwardedHost.includes("localhost") ? "http" : "https");
    return `${proto}://${forwardedHost}`.replace(/\/$/, "");
  }
  return new URL(c.req.url).origin.replace(/\/$/, "");
}

export function buildOAuthAuthorizationServerMetadata(origin: string, mount: string, scopes: string[]) {
  const cleanOrigin = origin.replace(/\/$/, "");
  const issuer = `${cleanOrigin}/${mount}`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopes,
  };
}

export function extractProtectedResourcePathFromWellKnown(pathname: string): string | null {
  if (pathname === PROTECTED_RESOURCE_WELL_KNOWN_PREFIX) return null;
  if (!pathname.startsWith(`${PROTECTED_RESOURCE_WELL_KNOWN_PREFIX}/`)) return null;
  const suffix = pathname.slice(PROTECTED_RESOURCE_WELL_KNOWN_PREFIX.length).replace(/\/+$/, "");
  if (!suffix || suffix === "/") return null;
  return suffix.startsWith("/") ? suffix : `/${suffix}`;
}

export function buildOAuthProtectedResourceMetadata(
  origin: string,
  resourcePath: string,
  mount: string,
  scopes: string[]
) {
  const cleanOrigin = origin.replace(/\/$/, "");
  return {
    authorization_servers: [`${cleanOrigin}/${mount}`],
    resource: `${cleanOrigin}${resourcePath}`,
    scopes_supported: scopes,
  };
}

