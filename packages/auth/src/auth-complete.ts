/**
 * Auth Complete - Handle authorization completion
 *
 * Validates verification codes and completes the authorization flow.
 */

import type {
  AuthCompleteRequest,
  AuthHttpRequest,
  AuthorizedPubkey,
  PendingAuthStore,
  PubkeyStore,
} from "./types.ts";

// ============================================================================
// Auth Complete Handler
// ============================================================================

/**
 * Options for handling auth completion
 */
export interface HandleAuthCompleteOptions {
  /** Pending auth store */
  pendingAuthStore: PendingAuthStore;
  /** Pubkey store */
  pubkeyStore: PubkeyStore;
  /** Authorization TTL in seconds (default: 30 days) */
  authorizationTTL?: number;
}

/**
 * Result of completing authorization
 */
export interface AuthCompleteResult {
  success: boolean;
  error?: string;
  errorDescription?: string;
}

/**
 * Complete authorization for a pubkey
 *
 * Called after user logs in and enters verification code.
 *
 * @param pubkey - The client's public key
 * @param verificationCode - The code entered by the user
 * @param userId - The authenticated user's ID
 * @param options - Completion options
 */
export async function completeAuthorization(
  pubkey: string,
  verificationCode: string,
  userId: string,
  options: HandleAuthCompleteOptions
): Promise<AuthCompleteResult> {
  const {
    pendingAuthStore,
    pubkeyStore,
    authorizationTTL = 30 * 24 * 60 * 60, // 30 days default
  } = options;

  // Get pending auth
  const pending = await pendingAuthStore.get(pubkey);
  if (!pending) {
    return {
      success: false,
      error: "not_found",
      errorDescription: "Authorization request not found or expired",
    };
  }

  // Validate verification code
  if (pending.verificationCode !== verificationCode) {
    return {
      success: false,
      error: "invalid_code",
      errorDescription: "Incorrect verification code",
    };
  }

  // Create authorized pubkey record
  const now = Date.now();
  const authorizedPubkey: AuthorizedPubkey = {
    pubkey,
    userId,
    clientName: pending.clientName,
    createdAt: now,
    expiresAt: now + authorizationTTL * 1000,
  };

  // Store authorization
  await pubkeyStore.store(authorizedPubkey);

  // Delete pending auth
  await pendingAuthStore.delete(pubkey);

  return { success: true };
}

/**
 * Handle POST /auth/complete request
 *
 * This is the API endpoint that the auth page calls after user enters code.
 * The auth page must also include the authenticated userId (from session).
 */
export async function handleAuthComplete(
  request: AuthHttpRequest,
  userId: string,
  options: HandleAuthCompleteOptions
): Promise<Response> {
  // Only accept POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: AuthCompleteRequest;
  try {
    const text = await request.text();
    body = JSON.parse(text) as AuthCompleteRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate required fields
  if (!body.pubkey || !body.verification_code) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description: "Missing required fields: pubkey, verification_code",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Complete authorization
  const result = await completeAuthorization(body.pubkey, body.verification_code, userId, options);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: result.error,
        error_description: result.errorDescription,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: "Authorization complete",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ============================================================================
// In-Memory Pubkey Store (for testing/development)
// ============================================================================

/**
 * Simple in-memory implementation of PubkeyStore
 *
 * Use only for testing/development. Use DynamoDB or Redis in production.
 */
export class MemoryPubkeyStore implements PubkeyStore {
  private _store = new Map<string, AuthorizedPubkey>();
  private userIndex = new Map<string, Set<string>>();

  async lookup(pubkey: string): Promise<AuthorizedPubkey | null> {
    const auth = this._store.get(pubkey);
    if (!auth) {
      return null;
    }

    // Check expiration
    if (auth.expiresAt && Date.now() > auth.expiresAt) {
      await this.revoke(pubkey);
      return null;
    }

    return auth;
  }

  async store(auth: AuthorizedPubkey): Promise<void> {
    this._store.set(auth.pubkey, auth);

    // Update user index
    let userPubkeys = this.userIndex.get(auth.userId);
    if (!userPubkeys) {
      userPubkeys = new Set();
      this.userIndex.set(auth.userId, userPubkeys);
    }
    userPubkeys.add(auth.pubkey);
  }

  async revoke(pubkey: string): Promise<void> {
    const auth = this._store.get(pubkey);
    if (auth) {
      // Remove from user index
      const userPubkeys = this.userIndex.get(auth.userId);
      if (userPubkeys) {
        userPubkeys.delete(pubkey);
        if (userPubkeys.size === 0) {
          this.userIndex.delete(auth.userId);
        }
      }
    }
    this._store.delete(pubkey);
  }

  async listByUser(userId: string): Promise<AuthorizedPubkey[]> {
    const pubkeys = this.userIndex.get(userId);
    if (!pubkeys) {
      return [];
    }

    const results: AuthorizedPubkey[] = [];
    const now = Date.now();

    for (const pubkey of pubkeys) {
      const auth = this._store.get(pubkey);
      if (auth) {
        if (auth.expiresAt && now > auth.expiresAt) {
          // Expired, clean up
          await this.revoke(pubkey);
        } else {
          results.push(auth);
        }
      }
    }

    return results;
  }

  /**
   * Clean up expired entries (call periodically)
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [pubkey, auth] of this._store) {
      if (auth.expiresAt && now > auth.expiresAt) {
        await this.revoke(pubkey);
      }
    }
  }
}
