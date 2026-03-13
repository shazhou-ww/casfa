/**
 * Delegate types for UI. Align with backend/shared when available.
 */
export type DelegateListItem = {
  delegateId: string;
  name?: string;
  createdAt: number;
  expiresAt?: number;
  isRevoked: boolean;
  depth?: number;
  /** When true, delegate can refresh tokens; do not show expires or expired status. */
  refreshable?: boolean;
};

export type CreateDelegateResponse = {
  delegate: DelegateListItem;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: number;
};
