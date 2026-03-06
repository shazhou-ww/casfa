import type { DelegateGrant, DelegateGrantStore, DelegatePermission } from "./types.ts";
import {
  createDelegateAccessToken,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
} from "./token.ts";

const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;

export async function listDelegates(
  grantStore: DelegateGrantStore,
  userId: string
): Promise<DelegateGrant[]> {
  return grantStore.list(userId);
}

export async function revokeDelegate(
  grantStore: DelegateGrantStore,
  delegateId: string
): Promise<void> {
  await grantStore.remove(delegateId);
}

export async function createDelegate(
  grantStore: DelegateGrantStore,
  params: { userId: string; clientName: string; permissions: DelegatePermission[] }
): Promise<{ grant: DelegateGrant; accessToken: string; refreshToken: string }> {
  const delegateId = generateDelegateId();
  const accessToken = createDelegateAccessToken(params.userId, delegateId);
  const refreshToken = generateRandomToken();
  const accessTokenHash = await sha256Hex(accessToken);
  const refreshTokenHash = await sha256Hex(refreshToken);

  const now = Date.now();
  const grant: DelegateGrant = {
    delegateId,
    userId: params.userId,
    clientName: params.clientName,
    permissions: params.permissions,
    accessTokenHash,
    refreshTokenHash,
    createdAt: now,
    expiresAt: now + DEFAULT_ACCESS_TTL_MS,
  };

  await grantStore.insert(grant);
  return { grant, accessToken, refreshToken };
}
