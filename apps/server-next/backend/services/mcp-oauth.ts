/**
 * MCP OAuth: in-memory auth code store and PKCE verification for browser OAuth flow.
 * Used by POST /api/oauth/mcp/authorize and POST /api/oauth/mcp/token.
 */
import { SignJWT } from "jose";
import type { DelegateGrantStore } from "../db/delegate-grants.ts";
import type { ServerConfig } from "../config.ts";

export type McpAuthCode = {
  clientId: string;
  clientName?: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  realmId: string;
  expiresAt: number;
};

const CODES = new Map<string, McpAuthCode>();
const CODE_TTL_MS = 5 * 60 * 1000; // 5 min

/** After successful exchange, cache token by code so Cursor ReloadClient can re-use the same code once. */
const USED_CODE_CACHE = new Map<
  string,
  { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
>();
const USED_CODE_CACHE_TTL_MS = 60 * 1000; // 1 min

export function cacheTokenForUsedCode(
  code: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshExpiresIn: number
): void {
  USED_CODE_CACHE.set(code, { accessToken, refreshToken, expiresIn, refreshExpiresIn });
  setTimeout(() => USED_CODE_CACHE.delete(code), USED_CODE_CACHE_TTL_MS);
}

export function getCachedTokenForUsedCode(code: string): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
} | null {
  return USED_CODE_CACHE.get(code) ?? null;
}

function randomCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createMcpAuthCode(entry: Omit<McpAuthCode, "expiresAt">): string {
  const code = randomCode();
  CODES.set(code, {
    ...entry,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

export async function consumeMcpAuthCodeAsync(
  code: string,
  params: { client_id: string; redirect_uri: string; code_verifier: string }
): Promise<McpAuthCode | null> {
  const stored = CODES.get(code);
  if (!stored || Date.now() > stored.expiresAt) return null;
  if (stored.clientId !== params.client_id || stored.redirectUri !== params.redirect_uri) return null;
  if (stored.codeChallengeMethod !== "S256") return null;
  const verifierBytes = new TextEncoder().encode(params.code_verifier);
  const hash = await crypto.subtle.digest("SHA-256", verifierBytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (b64 !== stored.codeChallenge) return null;
  CODES.delete(code);
  return stored;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Refresh token format: base64url({ sub, client_id }) + "." + random so we can decode realmId for lookup. */
function makeRefreshTokenPayload(realmId: string, clientId: string): string {
  const payload = base64urlEncode(JSON.stringify({ sub: realmId, client_id: clientId }));
  return `${payload}.${randomCode()}`;
}

/** Decode refresh token payload to get realmId and clientId. Returns null if invalid. */
export function decodeMcpRefreshTokenPayload(token: string): { realmId: string; clientId: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const decoded = atob(token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/"));
    const obj = JSON.parse(decoded) as { sub?: string; client_id?: string };
    if (typeof obj.sub !== "string" || typeof obj.client_id !== "string") return null;
    return { realmId: obj.sub, clientId: obj.client_id };
  } catch {
    return null;
  }
}

const REFRESH_EXPIRES_IN_SEC = 60 * 24 * 60 * 60; // 60 days

/** Generate new access + refresh token pair (and hashes). Does not insert into store. */
async function generateMcpTokenPair(
  realmId: string,
  clientId: string,
  config: ServerConfig
): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  expiresIn: number;
  refreshExpiresIn: number;
}> {
  const expSec = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
  let accessToken: string;
  const secret = config.auth.mockJwtSecret;
  if (secret) {
    const key = new Uint8Array(new TextEncoder().encode(secret));
    accessToken = await new SignJWT({ sub: realmId, client_id: clientId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(expSec)
      .sign(key);
  } else {
    const payload = { sub: realmId, client_id: clientId, exp: expSec };
    const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadB64 = base64urlEncode(JSON.stringify(payload));
    accessToken = `${header}.${payloadB64}.mcp`;
  }
  const refreshToken = makeRefreshTokenPayload(realmId, clientId);
  const accessTokenHash = await sha256Hex(accessToken);
  const refreshTokenHash = await sha256Hex(refreshToken);
  return {
    accessToken,
    refreshToken,
    accessTokenHash,
    refreshTokenHash,
    expiresIn: 30 * 24 * 60 * 60,
    refreshExpiresIn: REFRESH_EXPIRES_IN_SEC,
  };
}

/** Build a delegate access token: either signed JWT (when mockJwtSecret) or JWT-shaped string for lookup by hash. Also issues refresh_token and stores its hash. */
export async function createMcpDelegateToken(
  realmId: string,
  clientId: string,
  config: ServerConfig,
  delegateGrantStore: DelegateGrantStore
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}> {
  const delegateId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

  const pair = await generateMcpTokenPair(realmId, clientId, config);
  await delegateGrantStore.insert({
    delegateId,
    realmId,
    clientId,
    accessTokenHash: pair.accessTokenHash,
    refreshTokenHash: pair.refreshTokenHash,
    permissions: ["file_read", "file_write", "branch_manage"],
    createdAt: now,
    expiresAt,
  });

  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    refreshExpiresIn: pair.refreshExpiresIn,
  };
}

/** Exchange refresh_token for new access_token and refresh_token (rotation). Returns null if invalid. */
export async function refreshMcpTokens(
  refreshToken: string,
  clientId: string,
  config: ServerConfig,
  delegateGrantStore: DelegateGrantStore
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
} | null> {
  const payload = decodeMcpRefreshTokenPayload(refreshToken);
  if (!payload || payload.clientId !== clientId) return null;
  const refreshTokenHash = await sha256Hex(refreshToken);
  const grant = await delegateGrantStore.getByRefreshTokenHash(payload.realmId, refreshTokenHash);
  if (!grant) return null;
  const pair = await generateMcpTokenPair(grant.realmId, grant.clientId, config);
  await delegateGrantStore.updateTokens(grant.delegateId, {
    accessTokenHash: pair.accessTokenHash,
    refreshTokenHash: pair.refreshTokenHash,
  });
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    refreshExpiresIn: pair.refreshExpiresIn,
  };
}
