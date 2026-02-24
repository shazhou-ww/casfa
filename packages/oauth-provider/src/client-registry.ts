/**
 * Dynamic Client Registration (RFC 7591)
 *
 * Register and resolve OAuth clients. Supports:
 * - Static hardcoded clients (e.g. known IDE plugins)
 * - Dynamic registration via the `/register` endpoint
 */

import type { ClientStore, OAuthClient, Result } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Client registration request body (RFC 7591).
 */
export type ClientRegistrationRequest = {
  /** Human-readable client name */
  clientName: string;
  /** Redirect URIs for this client */
  redirectUris: string[];
  /** Requested grant types (defaults to ["authorization_code", "refresh_token"]) */
  grantTypes?: string[];
  /** Token endpoint auth method (defaults to "none") */
  tokenEndpointAuthMethod?: string;
};

/**
 * Options for {@link registerClient}.
 */
export type RegisterClientOptions = {
  /**
   * Custom client ID generator.
   * Default: `() => "dyn_" + crypto.randomUUID()`
   */
  generateClientId?: () => string;
  /**
   * Allowed grant types.
   * Default: `["authorization_code", "refresh_token"]`
   */
  allowedGrantTypes?: string[];
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Process a dynamic client registration request (RFC 7591).
 *
 * Validates the request, generates a client ID, persists via the store,
 * and returns the new client record.
 *
 * Validation enforced:
 * - `redirectUris` must be non-empty
 * - Each redirect URI must be localhost or HTTPS
 * - `grantTypes` must be a subset of `allowedGrantTypes`
 *
 * @param request - Registration request body
 * @param store - Client storage adapter
 * @param options - Optional configuration
 * @returns Created client record or validation error
 *
 * @example
 * ```ts
 * const result = await registerClient(
 *   { clientName: "My MCP Client", redirectUris: ["http://127.0.0.1:3000/callback"] },
 *   clientStore,
 * );
 * if (result.ok) {
 *   console.log(result.value.clientId); // "dyn_abc123..."
 * }
 * ```
 */
export async function registerClient(
  request: ClientRegistrationRequest,
  store: ClientStore,
  options?: RegisterClientOptions
): Promise<Result<OAuthClient>> {
  // Validate redirect URIs
  if (!request.redirectUris || request.redirectUris.length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid_client_metadata",
        message: "redirect_uris is required and must not be empty",
        statusCode: 400,
      },
    };
  }

  for (const uri of request.redirectUris) {
    try {
      const parsed = new URL(uri);
      const isLocalhost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
      const isHttps = parsed.protocol === "https:";
      if (!isLocalhost && !isHttps) {
        return {
          ok: false,
          error: {
            code: "invalid_client_metadata",
            message: `redirect_uri must be localhost or HTTPS: ${uri}`,
            statusCode: 400,
          },
        };
      }
    } catch {
      return {
        ok: false,
        error: {
          code: "invalid_client_metadata",
          message: `Invalid redirect_uri: ${uri}`,
          statusCode: 400,
        },
      };
    }
  }

  // Validate grant types
  const allowedGrants = new Set(
    options?.allowedGrantTypes ?? ["authorization_code", "refresh_token"]
  );
  const requestedGrants = request.grantTypes ?? ["authorization_code", "refresh_token"];
  const invalidGrants = requestedGrants.filter((g) => !allowedGrants.has(g));
  if (invalidGrants.length > 0) {
    return {
      ok: false,
      error: {
        code: "invalid_client_metadata",
        message: `Unsupported grant_types: ${invalidGrants.join(", ")}`,
        statusCode: 400,
      },
    };
  }

  // Generate client ID
  const generateId = options?.generateClientId ?? (() => `dyn_${crypto.randomUUID()}`);
  const clientId = generateId();

  const client: OAuthClient = {
    clientId,
    clientName: request.clientName,
    redirectUris: request.redirectUris,
    grantTypes: requestedGrants,
    tokenEndpointAuthMethod: "none",
    createdAt: Date.now(),
  };

  await store.save(client);
  return { ok: true, value: client };
}

// ============================================================================
// Client Resolution
// ============================================================================

/**
 * Resolve a client by ID: check hardcoded clients first, then the store.
 *
 * Hardcoded clients are useful for well-known static integrations
 * (e.g. VS Code extension) that don't need dynamic registration.
 *
 * @param clientId - Client ID to look up
 * @param store - Client storage adapter
 * @param hardcodedClients - Optional map of statically known clients
 * @returns Client record or `null` if not found
 *
 * @example
 * ```ts
 * const KNOWN_CLIENTS = new Map([
 *   ["vscode-mcp", { clientId: "vscode-mcp", clientName: "VS Code", ... }],
 * ]);
 *
 * const client = await resolveClient("vscode-mcp", store, KNOWN_CLIENTS);
 * ```
 */
export async function resolveClient(
  clientId: string,
  store: ClientStore,
  hardcodedClients?: Map<string, OAuthClient>
): Promise<OAuthClient | null> {
  // Check hardcoded first
  if (hardcodedClients) {
    const hardcoded = hardcodedClients.get(clientId);
    if (hardcoded) return hardcoded;
  }

  // Fall back to store
  return store.get(clientId);
}
