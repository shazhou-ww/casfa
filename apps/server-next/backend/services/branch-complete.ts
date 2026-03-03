/**
 * Shared branch-complete logic: merge branch into parent and remove branch.
 * Used by branches controller and MCP branch_complete tool.
 */
import type { BranchStore } from "../db/branch-store.ts";
import type { CasFacade } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { replaceSubtreeAtPath } from "./tree-mutations.ts";

export type BranchCompleteDeps = {
  branchStore: BranchStore;
  cas: CasFacade;
  key: KeyProvider;
};

export async function completeBranch(
  branchId: string,
  deps: BranchCompleteDeps
): Promise<{ completed: string }> {
  const branch = await deps.branchStore.getBranch(branchId);
  if (!branch) throw new Error("Branch not found");

  const parentId = branch.parentId;
  if (parentId === null) throw new Error("Cannot complete root branch");

  const childRootKey = await deps.branchStore.getBranchRoot(branchId);
  if (childRootKey === null) throw new Error("Branch has no root");

  const realmId = branch.realmId;
  const rootRecord = await deps.branchStore.getRealmRootRecord(realmId);
  const isParentRoot = rootRecord !== null && rootRecord.branchId === parentId;
  const parentRootKey = isParentRoot
    ? await deps.branchStore.getRealmRoot(realmId)
    : await deps.branchStore.getBranchRoot(parentId);
  if (parentRootKey === null) throw new Error("Parent has no root");

  const segments = branch.mountPath.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("Invalid mount path");

  const newParentRootKey = await replaceSubtreeAtPath(
    deps.cas,
    deps.key,
    parentRootKey,
    segments,
    childRootKey
  );

  if (isParentRoot) {
    await deps.branchStore.setRealmRoot(realmId, newParentRootKey);
  } else {
    await deps.branchStore.setBranchRoot(parentId, newParentRootKey);
  }
  await deps.branchStore.removeBranch(branchId);
  return { completed: branchId };
}
