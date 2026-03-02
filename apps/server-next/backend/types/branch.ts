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
};
