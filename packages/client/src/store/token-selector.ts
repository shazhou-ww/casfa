/**
 * Token selector and auto-issuer.
 *
 * Implements the "maximum authority" principle:
 * - When issuing tokens, prefer User JWT (depth=0) over Delegate Token
 * - Check issuer consistency before using existing tokens
 * - Re-issue tokens when issuer is not maximized
 */

import type { ServiceInfo } from "@casfa/protocol";
import type { StoredAccessToken, StoredDelegateToken } from "../types/tokens.ts";
import {
  isDelegateTokenValid,
  isUserTokenValid,
  shouldReissueAccessToken,
} from "./token-checks.ts";
import type { TokenStore } from "./token-store.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenSelectorConfig = {
  store: TokenStore;
  baseUrl: string;
  realm: string;
  serverInfo: ServiceInfo | null;
  defaultTokenTtl?: number;
};

export type TokenSelector = {
  /**
   * Get or issue an Access Token.
   * - If valid Access Token exists and is from max issuer, return it
   * - Otherwise, issue a new one using User JWT or Delegate Token
   */
  ensureAccessToken: () => Promise<StoredAccessToken | null>;

  /**
   * Get or issue a Delegate Token.
   * - If valid Delegate Token exists, return it
   * - If User JWT exists, issue a new one
   */
  ensureDelegateToken: () => Promise<StoredDelegateToken | null>;
};

// ============================================================================
// API Calls for Token Issuance
// ============================================================================

type CreateTokenRequest = {
  realm: string;
  name: string;
  type: "delegate" | "access";
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];
};

type CreateTokenResponse = {
  tokenId: string;
  tokenBase64: string;
  type: "delegate" | "access";
  issuerId: string;
  expiresAt: number;
  canUpload: boolean;
  canManageDepot: boolean;
};

/**
 * Issue a token using User JWT.
 */
const issueTokenWithUserJwt = async (
  baseUrl: string,
  userAccessToken: string,
  request: CreateTokenRequest
): Promise<CreateTokenResponse | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAccessToken}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      console.error("[TokenSelector] Failed to issue token with User JWT:", response.status);
      return null;
    }

    return (await response.json()) as CreateTokenResponse;
  } catch (err) {
    console.error("[TokenSelector] Error issuing token with User JWT:", err);
    return null;
  }
};

/**
 * Delegate a token using existing Delegate Token.
 */
const delegateToken = async (
  baseUrl: string,
  delegateTokenBase64: string,
  request: Omit<CreateTokenRequest, "realm">
): Promise<CreateTokenResponse | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/tokens/delegate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${delegateTokenBase64}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      console.error("[TokenSelector] Failed to delegate token:", response.status);
      return null;
    }

    return (await response.json()) as CreateTokenResponse;
  } catch (err) {
    console.error("[TokenSelector] Error delegating token:", err);
    return null;
  }
};

// ============================================================================
// Token Selector Factory
// ============================================================================

/**
 * Create a token selector instance.
 */
export const createTokenSelector = (config: TokenSelectorConfig): TokenSelector => {
  const { store, baseUrl, realm, serverInfo, defaultTokenTtl } = config;

  /**
   * Get token TTL in seconds.
   * Priority: defaultTokenTtl > server max > fallback
   */
  const getTokenTtl = (type: "delegate" | "access"): number => {
    if (defaultTokenTtl) return defaultTokenTtl;

    if (serverInfo?.limits) {
      if (type === "delegate" && serverInfo.limits.maxDelegateTokenTtl) {
        return serverInfo.limits.maxDelegateTokenTtl;
      }
      if (type === "access" && serverInfo.limits.maxAccessTokenTtl) {
        return serverInfo.limits.maxAccessTokenTtl;
      }
    }

    // Fallback: 1 hour for access, 30 days for delegate
    return type === "access" ? 3600 : 30 * 24 * 3600;
  };

  const ensureAccessToken = async (): Promise<StoredAccessToken | null> => {
    const state = store.getState();

    // Check if existing access token is valid and from max issuer
    if (!shouldReissueAccessToken(state)) {
      return state.access;
    }

    // Need to issue a new access token
    // Priority: User JWT > Delegate Token
    const userToken = state.user;
    const delegateToken_ = state.delegate;

    if (isUserTokenValid(userToken)) {
      // Issue with User JWT (max authority)
      const result = await issueTokenWithUserJwt(baseUrl, userToken!.accessToken, {
        realm,
        name: "auto-issued-access",
        type: "access",
        expiresIn: getTokenTtl("access"),
        canUpload: true,
        canManageDepot: true,
        scope: ["cas://depot:*"],
      });

      if (result) {
        const newToken: StoredAccessToken = {
          tokenId: result.tokenId,
          tokenBase64: result.tokenBase64,
          type: "access",
          issuerId: result.issuerId,
          expiresAt: result.expiresAt,
          canUpload: result.canUpload,
          canManageDepot: result.canManageDepot,
        };
        store.setAccess(newToken);
        return newToken;
      }
    }

    if (isDelegateTokenValid(delegateToken_)) {
      // Issue with Delegate Token (fallback)
      const result = await delegateToken(baseUrl, delegateToken_!.tokenBase64, {
        name: "auto-issued-access",
        type: "access",
        expiresIn: getTokenTtl("access"),
        canUpload: delegateToken_!.canUpload,
        canManageDepot: delegateToken_!.canManageDepot,
      });

      if (result) {
        const newToken: StoredAccessToken = {
          tokenId: result.tokenId,
          tokenBase64: result.tokenBase64,
          type: "access",
          issuerId: result.issuerId,
          expiresAt: result.expiresAt,
          canUpload: result.canUpload,
          canManageDepot: result.canManageDepot,
        };
        store.setAccess(newToken);
        return newToken;
      }
    }

    // No way to issue access token
    return null;
  };

  const ensureDelegateToken = async (): Promise<StoredDelegateToken | null> => {
    const state = store.getState();

    // Check if existing delegate token is valid
    if (isDelegateTokenValid(state.delegate)) {
      return state.delegate;
    }

    // Need to issue a new delegate token
    // Only User JWT can issue delegate tokens
    const userToken = state.user;

    if (!isUserTokenValid(userToken)) {
      return null;
    }

    const result = await issueTokenWithUserJwt(baseUrl, userToken!.accessToken, {
      realm,
      name: "auto-issued-delegate",
      type: "delegate",
      expiresIn: getTokenTtl("delegate"),
      canUpload: true,
      canManageDepot: true,
      scope: ["cas://depot:*"],
    });

    if (result) {
      const newToken: StoredDelegateToken = {
        tokenId: result.tokenId,
        tokenBase64: result.tokenBase64,
        type: "delegate",
        issuerId: result.issuerId,
        expiresAt: result.expiresAt,
        canUpload: result.canUpload,
        canManageDepot: result.canManageDepot,
      };
      store.setDelegate(newToken);
      return newToken;
    }

    return null;
  };

  return {
    ensureAccessToken,
    ensureDelegateToken,
  };
};
