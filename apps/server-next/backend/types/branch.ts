/**
 * Task-based branch: has parent, mountPath, root, TTL.
 * complete() merges back to parent and branch is invalidated.
 */
export type Branch = {
  branchId: string;
  realmId: string;
  parentId: string | null;
  mountPath: string;
  expiresAt: number;
  /** When set, path-based access /branch/:branchId/:value is allowed until expiresAt. */
  accessVerification?: { value: string; expiresAt: number };
};
