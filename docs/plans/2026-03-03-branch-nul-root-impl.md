# Branch NUL Root Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow creating a branch with a non-existent mountPath (NUL root); complete with NUL removes that path on parent; complete with real root ensures path then merges. Realm not initialized / branch not found return 4xx (no null for those cases).

**Architecture:** API layer enforces 4xx: getRealmRootRecord null → 404 before using realm root; getBranch null → 404 before getBranchRoot. getBranchRoot returns null only for existing branches with no root (NUL). Tree-mutations gain tryRemoveEntryAtPath (no-op when path missing) and ensurePathThenAddOrReplace. branch-complete handles NUL (remove or no-op) and non-NUL with missing path (ensure then replace). FS/files/MCP: worker with getCurrentRoot null → ensureEmptyRoot + setBranchRoot then perform op.

**Tech Stack:** Hono, Bun, @casfa/cas, @casfa/core, existing BranchStore (memory + Dynamo).

**Design ref:** `docs/plans/2026-03-03-branch-nul-root-design.md`

---

## Task 1: Branches create — 404 when realm has no root

**Files:**
- Modify: `apps/server-next/backend/controllers/branches.ts` (create, ~56–70)
- Test: `apps/server-next/tests/branches.test.ts`

**Step 1: Add test**

In `tests/branches.test.ts`, add (or extend) a test: create branch without ensuring realm root first (e.g. new realmId with no ensureRealmRoot), POST create branch, expect 404 and message like "Realm not initialized".

**Step 2: Run test to verify it fails**

```bash
cd apps/server-next && bun test tests/branches.test.ts
```

Expected: FAIL (currently may 404 with different message or pass if test realm has root).

**Step 3: Implement**

In `create(c)`, when `!parentBranchId`: after `const realmId = ...`, call `const rootRecord = await deps.branchStore.getRealmRootRecord(realmId)`. If `!rootRecord`, return `c.json({ error: "NOT_FOUND", message: "Realm not initialized. Open your profile or realm first." }, 404)`. Then use rootRecord only when non-null to get rootKey (getRealmRoot(realmId) after ensuring rootRecord exists). Remove or adjust the existing rootKey null check so 404 is only for missing root record.

**Step 4: Run test**

```bash
cd apps/server-next && bun test tests/branches.test.ts
```

Expected: PASS for new/updated test.

**Step 5: Commit**

```bash
git add apps/server-next/backend/controllers/branches.ts apps/server-next/tests/branches.test.ts
git commit -m "fix(server-next): 404 when realm not initialized on branch create"
```

---

## Task 2: Branches list/revoke/complete — 404 when branch not found

**Files:**
- Modify: `apps/server-next/backend/controllers/branches.ts` (list, revoke, complete)
- Test: `apps/server-next/tests/branches.test.ts`

**Step 1: Add/update tests**

- list: worker with invalid/revoked branchId → 404.
- revoke: revoke non-existent branchId for realm → 404.
- complete: complete with wrong branchId (or revoked) → 404.

**Step 2: Run tests**

```bash
cd apps/server-next && bun test tests/branches.test.ts
```

**Step 3: Implement**

- list (worker): already uses getBranch(auth.branchId); if !branch return 404 "Branch not found".
- revoke: after getBranch(branchId), if !branch || branch.realmId !== realmId return 404 "Branch not found".
- complete: resolve branchId (me → auth.branchId); getBranch(branchId); if !branch return 404 "Branch not found" before completeBranch.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/controllers/branches.ts apps/server-next/tests/branches.test.ts
git commit -m "fix(server-next): 404 when branch not found in list/revoke/complete"
```

---

## Task 3: Branch create — allow mountPath that does not resolve (NUL)

**Files:**
- Modify: `apps/server-next/backend/controllers/branches.ts` (create)
- Test: `apps/server-next/tests/branches.test.ts`

**Step 1: Add test**

Create branch with mountPath that does not exist under realm root. Expect 201, and getBranchRoot(branchId) returns null.

**Step 2: Run test**

Expected: FAIL (current code returns 400 "mountPath does not resolve").

**Step 3: Implement**

- From realm root: after childRootKey = resolvePath(...), if childRootKey === null: insertBranch(...), do not setBranchRoot, return 201. If childRootKey !== null, keep current setBranchRoot + 201.
- From parent branch: after getBranch 404 check, parentRootKey = getBranchRoot(parentBranchId). If parentRootKey === null return 400 "Parent branch has no root". resolvePath(parentRootKey, mountPath); if null, insertBranch without setBranchRoot, return 201; else setBranchRoot + 201.

**Step 4: Run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/controllers/branches.ts apps/server-next/tests/branches.test.ts
git commit -m "feat(server-next): allow branch create with non-existent mountPath (NUL root)"
```

---

## Task 4: tree-mutations — tryRemoveEntryAtPath (no-op when path missing)

**Files:**
- Modify: `apps/server-next/backend/services/tree-mutations.ts`
- Test: `apps/server-next/backend/__tests__/services/tree-mutations.test.ts` (create if missing)

**Step 1: Add test**

tryRemoveEntryAtPath(cas, key, rootKey, pathStr): when path does not exist, returns rootKey unchanged; when path exists, returns same as removeEntryAtPath.

**Step 2: Run test**

Expected: FAIL.

**Step 3: Implement**

Add tryRemoveEntryAtPath: normalize path, parentPath = segments.slice(0,-1).join("/"), fileName = segments[segments.length-1]. parentKey = parentPath === "" ? rootKey : resolvePath(cas, rootKey, parentPath). If parentKey null return rootKey. getNodeDecoded(parentKey); if !node or not dict return rootKey. nameIdx = names.indexOf(fileName); if nameIdx < 0 return rootKey. Else same as removeEntryAtPath: build newParentKey, putNode, then replaceSubtreeAtPath for parent path or return newParentKey if single segment.

**Step 4: Run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/services/tree-mutations.ts apps/server-next/backend/__tests__/services/tree-mutations.test.ts
git commit -m "feat(server-next): tryRemoveEntryAtPath no-op when path missing"
```

---

## Task 5: tree-mutations — ensurePathThenAddOrReplace

**Files:**
- Modify: `apps/server-next/backend/services/tree-mutations.ts`
- Test: `apps/server-next/backend/__tests__/services/tree-mutations.test.ts`

**Step 1: Add test**

ensurePathThenAddOrReplace(cas, key, rootKey, pathStr, newChildKey): when path exists, same as addOrReplaceAtPath; when path has missing segments, creates empty dicts, then add/replace. Returns new root key.

**Step 2: Run test**

Expected: FAIL.

**Step 3: Implement**

Normalize pathStr to segments. If segments.length === 0 throw. Iteratively ensure each prefix: for i from 0 to segments.length-2, resolvePath(cas, rootKey, segments.slice(0, i+1).join("/")). If null, create empty dict, addOrReplaceAtPath(cas, key, rootKey, segments.slice(0, i+1).join("/"), emptyDictKey) to create that path (parent of segment i exists by induction). Then addOrReplaceAtPath(cas, key, rootKey, pathStr, newChildKey). Return new root key.

**Step 4: Run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/services/tree-mutations.ts apps/server-next/backend/__tests__/services/tree-mutations.test.ts
git commit -m "feat(server-next): ensurePathThenAddOrReplace for complete on missing path"
```

---

## Task 6: branch-complete — NUL root: remove path (or no-op)

**Files:**
- Modify: `apps/server-next/backend/services/branch-complete.ts`
- Test: `apps/server-next/backend/__tests__/services/branch-complete.test.ts` or `tests/branches.test.ts`

**Step 1: Add test**

Complete a branch with NUL root. Expect 200; parent at mountPath removed if existed, else unchanged.

**Step 2: Run test**

Expected: FAIL (current throws "Branch has no root").

**Step 3: Implement**

In completeBranch: after getBranch/parentId/parentRootKey, childRootKey = getBranchRoot(branchId). If childRootKey === null: newParentRootKey = tryRemoveEntryAtPath(cas, key, parentRootKey, branch.mountPath). setRealmRoot or setBranchRoot(parentId, newParentRootKey), removeBranch(branchId), return { completed: branchId }. Else existing replaceSubtreeAtPath logic. Import tryRemoveEntryAtPath from tree-mutations.

**Step 4: Run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/services/branch-complete.ts apps/server-next/tests/branches.test.ts
git commit -m "feat(server-next): complete with NUL root removes path or no-op"
```

---

## Task 7: branch-complete — non-NUL root when path missing: ensure then replace

**Files:**
- Modify: `apps/server-next/backend/services/branch-complete.ts`

**Step 1: Add test**

Parent does not have mountPath; branch has real root. Complete → 200, parent has mountPath with branch content.

**Step 2: Run test**

Expected: FAIL (replaceSubtreeAtPath throws).

**Step 3: Implement**

When childRootKey !== null: if resolvePath(cas, parentRootKey, mountPath) === null, newParentRootKey = ensurePathThenAddOrReplace(cas, key, parentRootKey, mountPath, childRootKey). Else newParentRootKey = replaceSubtreeAtPath(...). Then setRealmRoot/setBranchRoot(parentId, newParentRootKey), removeBranch(branchId).

**Step 4: Run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/services/branch-complete.ts
git commit -m "feat(server-next): complete with real root ensures path then merges"
```

---

## Task 8: root-resolver — getCurrentRoot(worker) returns null for NUL

**Files:**
- Modify: `apps/server-next/backend/services/root-resolver.ts`
- Test: `apps/server-next/backend/__tests__/services/root-resolver.test.ts`

**Step 1: Add test**

Worker auth, branch exists but getBranchRoot returns null → getCurrentRoot returns null.

**Step 2: Implement**

getCurrentRoot(worker) already returns getBranchRoot(auth.branchId); no change unless something forces non-null. Ensure test passes.

**Step 3: Run test**

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server-next/backend/services/root-resolver.ts apps/server-next/backend/__tests__/services/root-resolver.test.ts
git commit -m "chore(server-next): getCurrentRoot(worker) returns null for NUL root"
```

---

## Task 9: FS controller — worker NUL: first write creates root then op

**Files:**
- Modify: `apps/server-next/backend/controllers/fs.ts` (mkdir, rm, mv, cp)
- Test: `apps/server-next/tests/fs.test.ts` or e2e

**Step 1: Add test**

Worker with NUL root. POST mkdir { path: "x" } → 201. List shows x.

**Step 2: Run test**

Expected: FAIL (404 "Realm not initialized").

**Step 3: Implement**

When auth.type === "worker": getBranch(auth.branchId); if !branch return 404 "Branch not found". rootKey = getCurrentRoot(auth, deps). If rootKey === null: emptyRootKey = ensureEmptyRoot(deps.cas, deps.key), setBranchRoot(auth.branchId, emptyRootKey), rootKey = emptyRootKey. Then continue (user/delegate: rootKey === null → 404 "Realm not initialized"). Apply to mkdir, rm, mv, cp. Use ensureEmptyRoot from root-resolver.

**Step 4: Run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/backend/controllers/fs.ts
git commit -m "feat(server-next): worker NUL root first write creates root then performs op"
```

---

## Task 10: Files controller — worker NUL: first upload creates root

**Files:**
- Modify: `apps/server-next/backend/controllers/files.ts`
- Test: `apps/server-next/tests/files.test.ts` or e2e

**Step 1: Add test**

Worker NUL root; PUT file at "f.txt" → 201.

**Step 2: Implement**

Same pattern: worker getBranch null → 404. getCurrentRoot null → ensureEmptyRoot + setBranchRoot, rootKey = that key. Proceed with upload.

**Step 3: Run test**

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server-next/backend/controllers/files.ts
git commit -m "feat(server-next): worker NUL root first upload creates root"
```

---

## Task 11: MCP handler — worker NUL for fs_write / fs_mkdir / list

**Files:**
- Modify: `apps/server-next/backend/mcp/handler.ts`

**Step 1: Add test**

MCP fs_mkdir / fs_write with worker whose branch has NUL root → success.

**Step 2: Implement**

Where worker uses getCurrentRoot: getBranch(auth.branchId) null → MCP error. rootKey = getCurrentRoot(auth, deps). If rootKey === null: ensureEmptyRoot, setBranchRoot(branchId, emptyRootKey), rootKey = emptyRootKey. Apply to fs_write, fs_mkdir, fs_rm, fs_mv, fs_cp, list_entries, get_metadata, file upload tools.

**Step 3: Run test**

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server-next/backend/mcp/handler.ts
git commit -m "feat(server-next): MCP worker NUL root first op creates root"
```

---

## Task 12: FS list/stat when root is NUL (worker)

**Files:**
- Modify: `apps/server-next/backend/controllers/fs.ts`, `controllers/files.ts`

**Step 1: Add test**

Worker NUL root; GET list → 200, entries: [].

**Step 2: Implement**

Worker and getCurrentRoot returns null: for list return 200 with entries: []. For stat at root return type dir, childCount 0. No setBranchRoot for read-only.

**Step 3: Run test**

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server-next/backend/controllers/fs.ts apps/server-next/backend/controllers/files.ts
git commit -m "feat(server-next): list/stat for worker NUL root returns empty dir"
```

---

## Task 13: E2E and regression

**Files:**
- Test: `apps/server-next/tests/`

**Step 1: Run full e2e**

```bash
cd apps/server-next && bun test tests/
```

**Step 2: Fix regressions**

Existing “path must exist” create-branch and complete merge tests must still pass.

**Step 3: Commit**

```bash
git add -A && git commit -m "test(server-next): e2e for branch NUL root and 4xx contract"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-03-branch-nul-root-impl.md`. Two execution options:

**1. Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach?
