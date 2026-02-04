/**
 * P256 authentication strategy (AWP Client).
 */

import type { AuthStrategy, P256AuthCallbacks, P256AuthState } from "../types/auth.ts";
import type { KeyPairProvider, P256KeyPair } from "../types/providers.ts";

export type P256AuthConfig = {
  callbacks: P256AuthCallbacks;
  keyPairProvider: KeyPairProvider;
};

/**
 * Convert bytes to hex string.
 */
const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Create a P256 authentication strategy using public key signature.
 */
export const createP256Auth = (config: P256AuthConfig): AuthStrategy => {
  const { callbacks: _callbacks, keyPairProvider } = config;

  // Note: callbacks will be used in polling flow
  void _callbacks;

  // Internal state
  const state: P256AuthState = {
    type: "p256",
    clientId: null,
    authorized: false,
  };

  let keyPair: P256KeyPair | null = null;

  const getState = (): P256AuthState => ({ ...state });

  const getAuthHeader = async (): Promise<string | null> => {
    // P256 auth uses custom headers, not Authorization header
    return null;
  };

  const getCustomHeaders = async (): Promise<Record<string, string>> => {
    if (!keyPair || !state.authorized) {
      return {};
    }

    const timestamp = Date.now().toString();
    const message = new TextEncoder().encode(timestamp);
    const signature = await keyPairProvider.sign(message, keyPair.privateKey);

    return {
      "X-AWP-Pubkey": bytesToHex(keyPair.publicKey),
      "X-AWP-Timestamp": timestamp,
      "X-AWP-Signature": bytesToHex(signature),
    };
  };

  const initialize = async (): Promise<void> => {
    // Try to load existing key pair
    keyPair = await keyPairProvider.load();

    if (!keyPair) {
      // Generate new key pair
      keyPair = await keyPairProvider.generate();
      await keyPairProvider.save(keyPair);
    }

    // Note: Client ID would be computed from public key hash
    // This is typically done server-side during auth init
  };

  const handleUnauthorized = async (): Promise<boolean> => {
    // P256 auth doesn't have automatic refresh
    // The client needs to re-authorize through the UI
    state.authorized = false;
    return false;
  };

  /**
   * Set the client ID after auth initialization.
   */
  const setClientId = (clientId: string) => {
    state.clientId = clientId;
  };

  /**
   * Mark the client as authorized after successful polling.
   */
  const setAuthorized = (authorized: boolean) => {
    state.authorized = authorized;
  };

  /**
   * Get the current key pair for signing.
   */
  const getKeyPair = (): P256KeyPair | null => keyPair;

  return {
    getState,
    getAuthHeader,
    getCustomHeaders,
    initialize,
    handleUnauthorized,
    // Additional methods for P256 flow
    setClientId,
    setAuthorized,
    getKeyPair,
  } as AuthStrategy & {
    setClientId: typeof setClientId;
    setAuthorized: typeof setAuthorized;
    getKeyPair: typeof getKeyPair;
  };
};

export type P256AuthStrategy = ReturnType<typeof createP256Auth>;
