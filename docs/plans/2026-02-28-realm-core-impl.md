# Realm 核心层实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the @casfa/realm package as specified in docs/plans/2026-02-28-realm-core-design.md: single-root file tree per realm, delegate tree with bound path, local-root optimistic commit, BlobStore.sweep(keysToRetain), and GC APIs.

**Architecture:** New package `packages/realm` depending only on @casfa/core, @casfa/cas-uri, @casfa/encoding. Injected BlobStore and DelegateDb; RealmService exposes createRootDelegate, createChildDelegate, read, put, commit, listReachableKeys, gcSweep. Path resolution and replace-subtree logic use core's getNode/makeDict and cas-uri PathSegment.

**Tech Stack:** TypeScript, Bun (test runner), @casfa/core, @casfa/cas-uri, @casfa/encoding.

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/realm/package.json`
- Create: `packages/realm/tsconfig.json`
- Create: `packages/realm/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@casfa/realm",
  "version": "0.1.0",
  "description": "Realm core: single-root file tree, delegate tree, local commit, GC",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun ../../scripts/build-pkg.ts",
    "test": "bun run test:unit",
    "test:unit": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "check": "tsc --noEmit && biome check .",
    "prepublishOnly": "bun run build"
  },
  "dependencies": {
    "@casfa/cas-uri": "workspace:*",
    "@casfa/core": "workspace:*",
    "@casfa/encoding": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "license": "MIT"
}
```

**Step 2: Create tsconfig.json**

Copy from `packages/delegate/tsconfig.json` or use root reference; ensure `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"outDir": "dist"`.

**Step 3: Create src/index.ts**

```ts
/**
 * @casfa/realm
 * Realm core: single-root file tree, delegate tree, local commit, GC.
 */
export {};
```

**Step 4: Add realm to root build order**

- Modify: `package.json` (root) — in `build:packages` script, add `cd ../realm && bun run build` after `cd ../core && bun run build` (so realm builds after core and cas-uri; ensure encoding is already in the chain — it is built before core).

**Step 5: Commit**

```bash
git add packages/realm/package.json packages/realm/tsconfig.json packages/realm/src/index.ts package.json
git commit -m "chore(realm): add package scaffold"
```

---

## Task 2: Error types

**Files:**
- Create: `packages/realm/src/errors.ts`
- Create: `packages/realm/tests/errors.test.ts`

**Step 1: Write failing test**

In `packages/realm/tests/errors.test.ts`: test that `RealmError` has codes `NotFound`, `InvalidPath`, `CommitConflict`, `NoRoot` and that `isRealmError(e)` returns true for these.

**Step 2: Run test**

Run: `cd packages/realm && bun test tests/errors.test.ts`  
Expected: FAIL (RealmError not defined).

**Step 3: Implement errors.ts**

Define `RealmError` with `code: 'NotFound' | 'InvalidPath' | 'CommitConflict' | 'NoRoot'` and optional `message`. Export `isRealmError(x: unknown): x is RealmError`.

**Step 4: Run test**

Expected: PASS.

**Step 5: Export from index.ts and commit**

```bash
git add packages/realm/src/errors.ts packages/realm/src/index.ts packages/realm/tests/errors.test.ts
git commit -m "feat(realm): add RealmError and error codes"
```

---

## Task 3: Storage interfaces and Delegate type

**Files:**
- Create: `packages/realm/src/storage.ts`
- Create: `packages/realm/src/types.ts`
- Modify: `packages/realm/src/index.ts`

**Step 1: Define BlobStore and DelegateDb in storage.ts**

- `BlobStore`: `get(key: string): Promise<Uint8Array | null>`, `put(key: string, value: Uint8Array): Promise<void>`, `sweep(keysToRetain: Set<string>): Promise<void>`.
- `DelegateDb`: `getRoot(realmId: string): Promise<string | null>`, `setRoot(realmId: string, nodeKey: string): Promise<void>`, `getDelegate(delegateId: string): Promise<Delegate | null>`, `insertDelegate(delegate: Delegate): Promise<void>`. Optional: `compareAndSetRoot(realmId, expected, newKey): Promise<boolean>`.

**Step 2: Define Delegate in types.ts**

- `delegateId: string`, `realmId: string`, `parentId: string | null`, `boundPath: PathSegment[]` (import PathSegment from @casfa/cas-uri). Optional: `name?: string`, `createdAt?: number`. Document that boundPath is name-only for storage.

**Step 3: Export from index**

Export storage interfaces and Delegate from `src/index.ts`.

**Step 4: Commit**

```bash
git add packages/realm/src/storage.ts packages/realm/src/types.ts packages/realm/src/index.ts
git commit -m "feat(realm): add BlobStore, DelegateDb, Delegate type"
```

---

## Task 4: Delegate ID generation

**Files:**
- Create: `packages/realm/src/id.ts`
- Create: `packages/realm/tests/id.test.ts`

**Step 1: Write failing test**

Test that `generateDelegateId()` returns string starting with `dlg_` and 26-character CB32 suffix; two calls yield different ids.

**Step 2: Implement id.ts**

Use `crypto.getRandomValues(new Uint8Array(16))` and `encodeCB32` from @casfa/encoding; prefix `dlg_`. Export `generateDelegateId(): string`.

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/id.test.ts
git add packages/realm/src/id.ts packages/realm/tests/id.test.ts packages/realm/src/index.ts
git commit -m "feat(realm): generate delegateId dlg_<crockford32(128bit)>"
```

---

## Task 5: Path resolution and name-only validation

**Files:**
- Create: `packages/realm/src/path.ts`
- Create: `packages/realm/tests/path.test.ts`

**Step 1: Write failing tests**

- resolvePath(rootKey, segments, getNode): resolve from root through name/index segments; return final node key or error.
- validateNameOnlyPath(segments): throw or return error if any segment is index.

**Step 2: Implement path.ts**

- `resolvePath`: async (rootKey, segments, getNode) — getNode(key) returns CasNode | null; traverse by name (childNames + children) or index (children[i]); return { key } or NotFound / InvalidPath (e.g. target is successor).
- `validateNameOnlyPath(segments: PathSegment[]): RealmError | null` — if any segment has kind === 'index', return InvalidPath; else null.
- Use @casfa/core decodeNode/getNode pattern; getNode is injected (BlobStore.get + decode).

**Step 3: Run tests and commit**

```bash
cd packages/realm && bun test tests/path.test.ts
git add packages/realm/src/path.ts packages/realm/tests/path.test.ts packages/realm/src/index.ts
git commit -m "feat(realm): path resolution and name-only validation"
```

---

## Task 6: Replace subtree at path (merge helper)

**Files:**
- Create: `packages/realm/src/merge.ts`
- Create: `packages/realm/tests/merge.test.ts`

**Step 1: Write failing test**

Given a root d-node and a path (name-only) and newChildKey, replaceSubtreeAtPath returns the new root key (new d-node hashes up the path). Use in-memory dict nodes and KeyProvider from core.

**Step 2: Implement merge.ts**

- `replaceSubtreeAtPath(rootKey, pathSegments, newChildKey, ctx: { getNode, makeDict, key })`: load root, walk path; at the final parent, replace the child at path's last segment with newChildKey; rebuild parent d-nodes up to root; return new root key. All nodes are dicts along the path; use makeDict from core with DictEntry[].

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/merge.test.ts
git add packages/realm/src/merge.ts packages/realm/tests/merge.test.ts packages/realm/src/index.ts
git commit -m "feat(realm): replace subtree at path for commit"
```

---

## Task 7: RealmService — createRootDelegate

**Files:**
- Create: `packages/realm/src/realm-service.ts`
- Create: `packages/realm/tests/realm-service.test.ts`

**Step 1: Write failing test**

Create RealmService with in-memory BlobStore (Map), in-memory DelegateDb (Map for root, Map for delegates). Call createRootDelegate('rlm_xxx'). Expect delegate with parentId null, boundPath [], realmId 'rlm_xxx'; delegateId starts with dlg_.

**Step 2: Implement createRootDelegate**

- RealmService(deps: { blob: BlobStore, db: DelegateDb, key: KeyProvider, generateDelegateId? }).
- createRootDelegate(realmId): generate delegateId, insertDelegate({ delegateId, realmId, parentId: null, boundPath: [] }), return delegate.

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/realm-service.test.ts
git add packages/realm/src/realm-service.ts packages/realm/tests/realm-service.test.ts packages/realm/src/index.ts
git commit -m "feat(realm): RealmService.createRootDelegate"
```

---

## Task 8: RealmService — createChildDelegate

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1: Write failing test**

Create root delegate, set realm root to a d-node (put node in blob, setRoot). createChildDelegate(rootId, [{ kind: 'name', value: 'a' }]). Expect new delegate with boundPath [{ kind: 'name', value: 'a' }], parentId = rootId. If path is index segment, expect InvalidPath. If path resolves to successor, expect InvalidPath.

**Step 2: Implement createChildDelegate**

- Load parent delegate; load realm root; resolvePath(root, parent.boundPath) then resolvePath(thatKey, parse relativePath — name-only). Validate result is dict or file (not successor). Insert new delegate with boundPath = parent.boundPath concat relativePath (name segments only).

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/realm-service.test.ts
git add packages/realm/src/realm-service.ts packages/realm/tests/realm-service.test.ts
git commit -m "feat(realm): RealmService.createChildDelegate"
```

---

## Task 9: RealmService — read

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1: Write failing test**

Set realm root to a d-node with child 'f' (file). read(delegateId, [{ kind: 'name', value: 'f' }]) returns file content or node info. read with index segment into file chunk works.

**Step 2: Implement read**

- Load delegate, get realm root; resolvePath(root, delegate.boundPath) to get logical root key; resolvePath(logicalRoot, relativePath) with full segment support; return node or bytes (for file/successor) or dir listing.

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/realm-service.test.ts
git commit -m "feat(realm): RealmService.read"
```

---

## Task 10: RealmService — put

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1: Write failing test**

put(delegateId, relativePath, payload) encodes node (dict or file) via core, puts to BlobStore; does not change realm root. Later commit can attach this node.

**Step 2: Implement put**

- Resolve delegate and logical root; relativePath may point to a new child (e.g. new file under logical root). Build new node (makeDict or putFileNode), put to blob; return new node key. Do not call setRoot.

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/realm-service.test.ts
git commit -m "feat(realm): RealmService.put"
```

---

## Task 11: RealmService — commit

**Files:**
- Modify: `packages/realm/src/realm-service.ts`
- Modify: `packages/realm/tests/realm-service.test.ts`

**Step 1: Write failing test**

Realm root is d-node with child 'a'. Delegate bound at 'a'. commit(delegateId, currentKeyOfA, newKeyOfA) updates realm root to new root where 'a' points to newKeyOfA. If baseLocalRoot !== current key at bound path, expect CommitConflict.

**Step 2: Implement commit**

- Get delegate, realm root; resolvePath(root, delegate.boundPath) to get current key at bound path. If current !== baseLocalRoot, return CommitConflict. Else replaceSubtreeAtPath(root, delegate.boundPath, newLocalRoot, ctx) to get newRootKey; setRoot(realmId, newRootKey).

**Step 3: Run test and commit**

```bash
cd packages/realm && bun test tests/realm-service.test.ts
git commit -m "feat(realm): RealmService.commit with local-root optimistic lock"
```

---

## Task 12: listReachableKeys and gcSweep

**Files:**
- Modify: `packages/realm/src/realm-service.ts` (or add gc.ts)
- Modify: `packages/realm/tests/realm-service.test.ts` or `packages/realm/tests/gc.test.ts`

**Step 1: Write failing test**

Set realm root to a small DAG (dict with two children). listReachableKeys(realmId) returns set containing root and all descendants. gcSweep(realmId) calls blob.sweep(reachable); then blob.get(anyDeletedKey) is null.

**Step 2: Implement listReachableKeys**

- Get realm root; BFS/DFS traverse: get node bytes from blob, decode, add children to queue; collect all keys. Return Set<string>.

**Step 3: Implement gcSweep**

- listReachableKeys(realmId), then blob.sweep(reachableSet).

**Step 4: Run test and commit**

```bash
cd packages/realm && bun test tests/gc.test.ts
git commit -m "feat(realm): listReachableKeys and gcSweep"
```

---

## Task 13: Wire root test:unit and final export

**Files:**
- Modify: `package.json` (root) — add `cd ../realm && bun run test:unit` in test:unit script (after core or delegate).
- Modify: `packages/realm/src/index.ts` — export all public API: errors, types, storage, id, path, merge, RealmService, listReachableKeys, gcSweep.

**Step 5: Run full test and typecheck**

```bash
cd packages/realm && bun run check && bun test
cd ../.. && bun run test:unit
```

**Step 6: Commit**

```bash
git add package.json packages/realm/src/index.ts
git commit -m "chore(realm): wire test:unit and export public API"
```

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-28-realm-core-impl.md`.

Two execution options:

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach?
