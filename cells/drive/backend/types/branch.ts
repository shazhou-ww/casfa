/**
 * Task-based branch: has parent, root, TTL.
 * mountPath-based semantics are removed; transfer_paths controls publish target.
 */
export type Branch = {
  branchId: string;
  realmId: string;
  parentId: string | null;
  expiresAt: number;
  /** When set, path-based access /branch/:branchId/:value is allowed until expiresAt. */
  accessVerification?: { value: string; expiresAt: number };
};
