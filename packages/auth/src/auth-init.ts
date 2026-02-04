/**
 * Auth Init - Handle authorization initiation
 *
 * Generates server-side verification codes and manages pending authorizations.
 */

import type {
  AuthHttpRequest,
  AuthInitRequest,
  AuthInitResponse,
  PendingAuth,
  PendingAuthStore,
} from "./types.ts";
import { AWP_AUTH_DEFAULTS } from "./types.ts";

// ============================================================================
// Verification Code Generation
// ============================================================================

/**
 * Generate a random verification code
 *
 * Format: XXX-XXX (6 alphanumeric characters with hyphen)
 * Uses crypto-secure random generation.
 */
export function generateVerificationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Avoid ambiguous chars (0, O, 1, I)
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i]! % chars.length];
    if (i === 2) code += "-"; // Add hyphen in middle
  }

  return code;
}

// ============================================================================
// Auth Init Handler
// ============================================================================

/**
 * Options for handling auth init request
 */
export interface HandleAuthInitOptions {
  /** Base URL for building auth URLs */
  baseUrl: string;
  /** Pending auth store */
  pendingAuthStore: PendingAuthStore;
  /** Path to auth page */
  authPagePath?: string;
  /** TTL for verification code in seconds */
  verificationCodeTTL?: number;
  /** Poll interval in seconds */
  pollInterval?: number;
}

/**
 * Validate public key format
 */
function isValidPubkey(pubkey: string): boolean {
  if (!pubkey || typeof pubkey !== "string") {
    return false;
  }

  const parts = pubkey.split(".");
  if (parts.length !== 2) {
    return false;
  }

  // Each part should be base64url encoded
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return base64urlRegex.test(parts[0]!) && base64urlRegex.test(parts[1]!);
}

/**
 * Handle POST /auth/init request
 *
 * Creates a pending authorization and returns verification code.
 */
export async function handleAuthInit(
  request: AuthHttpRequest,
  options: HandleAuthInitOptions
): Promise<Response> {
  const {
    baseUrl,
    pendingAuthStore,
    authPagePath = AWP_AUTH_DEFAULTS.authPagePath,
    verificationCodeTTL = AWP_AUTH_DEFAULTS.verificationCodeTTL,
    pollInterval = AWP_AUTH_DEFAULTS.pollInterval,
  } = options;

  // Only accept POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: AuthInitRequest;
  try {
    const text = await request.text();
    body = JSON.parse(text) as AuthInitRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate required fields
  if (!body.pubkey || !body.client_name) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description: "Missing required fields: pubkey, client_name",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate pubkey format
  if (!isValidPubkey(body.pubkey)) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description: "Invalid pubkey format",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Generate verification code
  const verificationCode = generateVerificationCode();
  const now = Date.now();
  const expiresAt = now + verificationCodeTTL * 1000;

  // Create pending auth record
  const pendingAuth: PendingAuth = {
    pubkey: body.pubkey,
    clientName: body.client_name,
    verificationCode,
    createdAt: now,
    expiresAt,
  };

  // Store pending auth
  await pendingAuthStore.create(pendingAuth);

  // Build auth URL
  const authUrl = new URL(authPagePath, baseUrl);
  authUrl.searchParams.set("pubkey", body.pubkey);

  // Build response
  const response: AuthInitResponse = {
    auth_url: authUrl.toString(),
    verification_code: verificationCode,
    expires_in: verificationCodeTTL,
    poll_interval: pollInterval,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================================
// Auth Status Handler
// ============================================================================

/**
 * Options for handling auth status request
 */
export interface HandleAuthStatusOptions {
  /** Pubkey store to check authorization status */
  pubkeyStore: import("./types.ts").PubkeyStore;
  /** Pending auth store to check if still pending */
  pendingAuthStore: PendingAuthStore;
}

/**
 * Handle GET /auth/status request
 *
 * Check if a pubkey has been authorized.
 */
export async function handleAuthStatus(
  request: AuthHttpRequest,
  options: HandleAuthStatusOptions
): Promise<Response> {
  const { pubkeyStore, pendingAuthStore } = options;

  // Only accept GET
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get pubkey from query params
  const url = new URL(request.url);
  const pubkey = url.searchParams.get("pubkey");

  if (!pubkey) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Missing pubkey parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check if authorized
  const authInfo = await pubkeyStore.lookup(pubkey);
  if (authInfo) {
    return new Response(
      JSON.stringify({
        authorized: true,
        expires_at: authInfo.expiresAt,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check if still pending
  const pending = await pendingAuthStore.get(pubkey);
  if (pending) {
    // Still waiting for user to complete authorization
    return new Response(
      JSON.stringify({
        authorized: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Not pending, not authorized - expired or never existed
  return new Response(
    JSON.stringify({
      authorized: false,
      error: "Authorization request expired or not found",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ============================================================================
// In-Memory Store (for testing/development)
// ============================================================================

/**
 * Simple in-memory implementation of PendingAuthStore
 *
 * Use only for testing/development. Use DynamoDB or Redis in production.
 */
export class MemoryPendingAuthStore implements PendingAuthStore {
  private store = new Map<string, PendingAuth>();

  async create(auth: PendingAuth): Promise<void> {
    this.store.set(auth.pubkey, auth);
  }

  async get(pubkey: string): Promise<PendingAuth | null> {
    const auth = this.store.get(pubkey);
    if (!auth) {
      return null;
    }

    // Check expiration
    if (Date.now() > auth.expiresAt) {
      this.store.delete(pubkey);
      return null;
    }

    return auth;
  }

  async delete(pubkey: string): Promise<void> {
    this.store.delete(pubkey);
  }

  async validateCode(pubkey: string, code: string): Promise<boolean> {
    const auth = await this.get(pubkey);
    if (!auth) {
      return false;
    }
    return auth.verificationCode === code;
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [pubkey, auth] of this.store) {
      if (now > auth.expiresAt) {
        this.store.delete(pubkey);
      }
    }
  }
}
