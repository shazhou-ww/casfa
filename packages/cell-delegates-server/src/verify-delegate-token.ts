import type { DelegateAuth, DelegateGrantStore } from "./types.ts";
import { decodeDelegateTokenPayload, sha256Hex } from "./token.ts";

/**
 * Verifies a delegate Bearer token against the grant store.
 * Returns DelegateAuth if the token is valid, null otherwise.
 */
export async function verifyDelegateToken(
  grantStore: DelegateGrantStore,
  bearerToken: string
): Promise<DelegateAuth | null> {
  const payload = decodeDelegateTokenPayload(bearerToken);
  if (!payload) return null;

  const hash = await sha256Hex(bearerToken);
  const grant = await grantStore.getByAccessTokenHash(payload.sub, hash);
  if (!grant) return null;

  return {
    type: "delegate",
    userId: grant.userId,
    delegateId: grant.delegateId,
    permissions: grant.permissions,
  };
}
