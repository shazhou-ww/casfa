/**
 * AWP Auth - ECDSA P-256 Signature Verification
 *
 * Verifies request signatures using the client's public key.
 * Signature format: timestamp.METHOD.path.bodyHash
 */

import type { AuthContext, AuthHttpRequest, AuthResult, PubkeyStore } from "./types.ts";
import { AWP_AUTH_DEFAULTS, AWP_AUTH_HEADERS } from "./types.ts";

// ============================================================================
// Constants
// ============================================================================

const ALGORITHM = {
  name: "ECDSA",
  namedCurve: "P-256",
} as const;

const VERIFY_ALGORITHM = {
  name: "ECDSA",
  hash: "SHA-256",
} as const;

// ============================================================================
// Base64url Utilities
// ============================================================================

/**
 * Decode base64url string to bytes
 */
function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padding);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Encode bytes to base64url string
 */
function base64urlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ============================================================================
// Public Key Import
// ============================================================================

/**
 * Import a public key from AWP format (x.y base64url)
 */
async function importPublicKey(pubkey: string): Promise<CryptoKey> {
  const [x, y] = pubkey.split(".");
  if (!x || !y) {
    throw new Error("Invalid public key format: expected x.y");
  }

  const publicJwk = {
    kty: "EC",
    crv: "P-256",
    x,
    y,
  };

  return crypto.subtle.importKey("jwk", publicJwk, ALGORITHM, true, ["verify"]);
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify an ECDSA P-256 signature
 */
export async function verifySignature(
  pubkey: string,
  payload: string,
  signature: string
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey(pubkey);
    const signatureBytes = base64urlDecode(signature);
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payload);

    return crypto.subtle.verify(
      VERIFY_ALGORITHM,
      publicKey,
      signatureBytes.buffer as ArrayBuffer,
      payloadBytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Validate timestamp is within allowed clock skew
 */
export function validateTimestamp(timestamp: string, maxClockSkew: number): boolean {
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - ts);

  return diff <= maxClockSkew;
}

/**
 * Build the signature payload from request components
 */
function buildSignaturePayload(
  timestamp: string,
  method: string,
  path: string,
  bodyHash: string
): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
}

/**
 * Hash request body using SHA-256
 */
async function hashBody(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBytes);
  return base64urlEncode(new Uint8Array(hashBuffer));
}

// ============================================================================
// Request Verification
// ============================================================================

/**
 * Extract AWP auth headers from request
 */
function extractAuthHeaders(request: AuthHttpRequest): {
  pubkey: string | null;
  timestamp: string | null;
  signature: string | null;
} {
  const headers = request.headers;
  const get = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    return headers[name] ?? null;
  };

  return {
    pubkey: get(AWP_AUTH_HEADERS.pubkey),
    timestamp: get(AWP_AUTH_HEADERS.timestamp),
    signature: get(AWP_AUTH_HEADERS.signature),
  };
}

/**
 * Check if a request has AWP auth credentials
 */
export function hasAwpAuthCredentials(request: AuthHttpRequest): boolean {
  const { pubkey, signature } = extractAuthHeaders(request);
  return pubkey !== null && signature !== null;
}

/**
 * Verify AWP auth signature on a request
 *
 * @param request - The HTTP request to verify
 * @param pubkeyStore - Store to look up authorized pubkeys
 * @param maxClockSkew - Maximum allowed clock skew in seconds
 * @returns Auth result with context if authorized
 */
export async function verifyAwpAuth(
  request: AuthHttpRequest,
  pubkeyStore: PubkeyStore,
  maxClockSkew: number = AWP_AUTH_DEFAULTS.maxClockSkew
): Promise<AuthResult> {
  // Extract headers
  const { pubkey, timestamp, signature } = extractAuthHeaders(request);

  // Check all required headers are present
  if (!pubkey || !timestamp || !signature) {
    return {
      authorized: false,
    };
  }

  // Validate timestamp
  if (!validateTimestamp(timestamp, maxClockSkew)) {
    return {
      authorized: false,
    };
  }

  // Look up pubkey in store
  const authInfo = await pubkeyStore.lookup(pubkey);
  if (!authInfo) {
    return {
      authorized: false,
    };
  }

  // Check if authorization has expired
  if (authInfo.expiresAt && Date.now() > authInfo.expiresAt) {
    return {
      authorized: false,
    };
  }

  // Build signature payload
  const url = new URL(request.url);
  const path = url.pathname + url.search;
  const body = await request.clone().text();
  const bodyHash = await hashBody(body);
  const payload = buildSignaturePayload(timestamp, request.method, path, bodyHash);

  // Verify signature
  const valid = await verifySignature(pubkey, payload, signature);
  if (!valid) {
    return {
      authorized: false,
    };
  }

  // Success!
  const context: AuthContext = {
    userId: authInfo.userId,
    pubkey: authInfo.pubkey,
    clientName: authInfo.clientName,
  };

  return {
    authorized: true,
    context,
  };
}

// ============================================================================
// Challenge Response Builder
// ============================================================================

/**
 * Build a 401 challenge response
 */
export function buildChallengeResponse(authInitEndpoint: string): Response {
  const body = {
    error: "unauthorized" as const,
    error_description: "Authentication required",
    auth_init_endpoint: authInitEndpoint,
  };

  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `AWP realm="awp"`,
    },
  });
}
