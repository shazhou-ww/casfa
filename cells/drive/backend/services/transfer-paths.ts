import type { CasFacade } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import type { BranchStore } from "../db/branch-store.ts";
import { ensureEmptyRoot, resolvePath } from "./root-resolver.ts";
import { ensurePathThenAddOrReplace } from "./tree-mutations.ts";
import type { TransferMode, TransferSpec } from "../types/transfer.ts";

function normalizePath(pathValue: string): string {
  const trimmed = pathValue.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    throw new Error("path must not be empty");
  }
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("path must not contain invalid segments");
    }
  }
  return segments.join("/");
}

function hasAncestorOrDescendantConflict(paths: string[]): boolean {
  const sorted = [...paths].sort();
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    if (next.startsWith(`${current}/`)) {
      return true;
    }
  }
  return false;
}

export function validateTransferSpec(spec: TransferSpec): {
  source: string;
  target: string;
  mapping: Record<string, string>;
  mode: TransferMode;
} {
  if (!spec.source?.trim()) {
    throw new Error("source is required");
  }
  if (!spec.target?.trim()) {
    throw new Error("target is required");
  }
  const entries = Object.entries(spec.mapping ?? {});
  if (entries.length === 0) {
    throw new Error("mapping must not be empty");
  }

  const normalized: Record<string, string> = {};
  const targets = new Set<string>();
  for (const [fromPath, toPath] of entries) {
    const from = normalizePath(fromPath);
    const to = normalizePath(toPath);
    normalized[from] = to;
    if (targets.has(to)) {
      throw new Error("target paths must be unique");
    }
    targets.add(to);
  }

  if (hasAncestorOrDescendantConflict([...targets])) {
    throw new Error("target paths must not be ancestor/descendant");
  }

  return {
    source: spec.source.trim(),
    target: spec.target.trim(),
    mapping: normalized,
    mode: spec.mode ?? "fail_if_exists",
  };
}

export type ExecuteTransferDeps = {
  branchStore: BranchStore;
  cas: CasFacade;
  key: KeyProvider;
  recordNewKey?: (realmId: string, nodeKey: string) => void;
};

export async function executeTransfer(
  spec: TransferSpec,
  deps: ExecuteTransferDeps
): Promise<{ applied: number; targetBranchId: string }> {
  const normalized = validateTransferSpec(spec);
  if (normalized.mode === "merge_dir") {
    throw new Error("merge_dir is not implemented");
  }

  const sourceBranch = await deps.branchStore.getBranch(normalized.source);
  if (!sourceBranch) {
    throw new Error("source branch not found");
  }
  const targetBranch = await deps.branchStore.getBranch(normalized.target);
  if (!targetBranch) {
    throw new Error("target branch not found");
  }
  if (sourceBranch.realmId !== targetBranch.realmId) {
    throw new Error("source and target must be in same realm");
  }

  const sourceRootKey = await deps.branchStore.getBranchRoot(sourceBranch.branchId);
  if (!sourceRootKey) {
    throw new Error("source branch has no root");
  }

  let targetRootKey = await deps.branchStore.getBranchRoot(targetBranch.branchId);
  if (!targetRootKey) {
    const emptyRoot = await ensureEmptyRoot(deps.cas, deps.key);
    await deps.branchStore.setBranchRoot(targetBranch.branchId, emptyRoot);
    targetRootKey = emptyRoot;
    deps.recordNewKey?.(targetBranch.realmId, emptyRoot);
  }

  const resolvedEntries: Array<{ fromPath: string; toPath: string; sourceNodeKey: string }> = [];
  for (const [fromPath, toPath] of Object.entries(normalized.mapping)) {
    const sourceNodeKey = await resolvePath(deps.cas, sourceRootKey, fromPath);
    if (!sourceNodeKey) {
      throw new Error(`source path not found: ${fromPath}`);
    }
    if (normalized.mode === "fail_if_exists") {
      const existingTargetNode = await resolvePath(deps.cas, targetRootKey, toPath);
      if (existingTargetNode) {
        throw new Error(`target path exists: ${toPath}`);
      }
    }
    resolvedEntries.push({ fromPath, toPath, sourceNodeKey });
  }

  let newTargetRoot = targetRootKey;
  const onNodePut = deps.recordNewKey
    ? (nodeKey: string) => deps.recordNewKey!(targetBranch.realmId, nodeKey)
    : undefined;
  for (const entry of resolvedEntries) {
    newTargetRoot = await ensurePathThenAddOrReplace(
      deps.cas,
      deps.key,
      newTargetRoot,
      entry.toPath,
      entry.sourceNodeKey,
      onNodePut
    );
  }
  if (newTargetRoot !== targetRootKey) {
    await deps.branchStore.setBranchRoot(targetBranch.branchId, newTargetRoot);
  }

  return {
    applied: resolvedEntries.length,
    targetBranchId: targetBranch.branchId,
  };
}
