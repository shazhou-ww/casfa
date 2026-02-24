# DAG Diff — Design Document

## Overview

`@casfa/dag-diff` computes the **edit distance** between two CAS DAG roots
from a **file-system perspective**. It compares two d-node trees, producing a
list of added / removed / modified / moved entries at the **f-node level**
(file granularity — s-node internals are not inspected).

## Scope

| In scope | Out of scope |
|----------|-------------|
| d-node (directory) traversal | s-node (successor) level diff |
| f-node (file) identity comparison by key | Byte-level file content diff |
| Relative-path based entry matching | set-node support (throws error) |
| Moved / renamed detection (post-processing) | Content-type change detection |

## Data Model

### DiffEntry

```typescript
type DiffEntryKind = "file" | "dir";

type DiffEntry =
  | { type: "added";    path: string; nodeKey: string; kind: DiffEntryKind }
  | { type: "removed";  path: string; nodeKey: string; kind: DiffEntryKind }
  | { type: "modified"; path: string; oldNodeKey: string; newNodeKey: string;
      typeChange: "none" | "file2dir" | "dir2file" }
  | { type: "moved"; pathsFrom: string[]; pathsTo: string[];
      nodeKey: string; kind: DiffEntryKind };
```

Design decisions:
- **`modified` with `typeChange`**: When the same name at the same path
  changes from d-node → f-node (or vice-versa), it is reported as `modified`
  with `typeChange: "dir2file"` or `"file2dir"`.
- **Leaf-only reporting (Plan A)**: Intermediate d-node changes are NOT
  reported — only leaf-level f-node or terminal d-node changes appear.
- **`moved`**: Produced by post-processing `added` + `removed` entries that
  share the same `nodeKey`. Because DAGs allow the same key at multiple
  paths, moved entries use `pathsFrom: string[]` / `pathsTo: string[]`.
  Even a 1:1 rename uses the array form for uniformity.

### DiffResult

```typescript
type DiffResult = {
  entries: DiffEntry[];
  truncated: boolean;
  stats: { added: number; removed: number; modified: number; moved: number };
};
```

### DiffOptions

```typescript
type DagDiffOptions = {
  storage: StorageProvider;
  /** Max d-node nesting depth. At limit, unresolved sub-trees are reported
   *  as a single `modified` entry for the directory path. */
  maxDepth?: number;
  /** Max entries before truncation (default: unlimited). */
  maxEntries?: number;
};
```

## Algorithm

### Core: Hash-Short-Circuit Tree Diff

Two d-nodes are compared using a **sorted merge-join** on their children
(d-node children are sorted by UTF-8 byte order per CAS spec §3.2):

```
function diff(oldKey, newKey, path, depth):
  if oldKey === newKey → skip (hash short-circuit)

  oldNode = decode(storage.get(oldKey))
  newNode = decode(storage.get(newKey))

  validate: reject set-node, handle type mismatches

  merge-join oldNode.childNames × newNode.childNames:
    name only in old → removed (recurse if d-node to collect all leaves)
    name only in new → added   (recurse if d-node to collect all leaves)
    name in both, same hash → skip
    name in both, diff hash:
      both d-nodes → recurse diff(oldChild, newChild, path/name, depth+1)
      both f-nodes → modified (typeChange: "none")
      one d / one f → modified (typeChange: "file2dir" or "dir2file")
```

**Complexity**: O(number of changed nodes), NOT O(total tree size), thanks
to hash short-circuiting.

### maxDepth Handling

When `depth >= maxDepth` and a sub-d-node has a different hash, the entire
directory is reported as `{ type: "modified", path, typeChange: "none" }`
without further recursion.

### Collecting Leaves (for added/removed subtrees)

When a name exists only on one side and points to a d-node, we recursively
collect all leaf f-nodes (and empty d-nodes) so the diff shows individual
file paths rather than a single directory entry.

### Moved Detection (Post-Processing)

After the core diff produces `added` / `removed` / `modified` entries:

1. Group all `added` entries by `nodeKey`.
2. Group all `removed` entries by `nodeKey`.
3. For each `nodeKey` appearing in BOTH groups:
   - Remove those entries from added/removed.
   - Emit `{ type: "moved", pathsFrom: [...removedPaths], pathsTo: [...addedPaths], nodeKey, kind }`.
4. A key participating in moved must be entirely consumed — if a key has
   3 removes and 2 adds, all 5 become one `moved` entry.

Moved detection only runs in the non-streaming API. The streaming API
produces raw `added | removed | modified` entries only.

## API

```typescript
// Streaming — yields added / removed / modified (no moved detection)
async function* dagDiffStream(
  oldRootKey: string,
  newRootKey: string,
  options: DagDiffOptions
): AsyncGenerator<DiffEntry>;

// Batch — collects stream, applies moved detection, returns DiffResult
async function dagDiff(
  oldRootKey: string,
  newRootKey: string,
  options: DagDiffOptions
): Promise<DiffResult>;
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Same root key | Return empty diff immediately |
| One/both roots are EMPTY_DICT_KEY | All entries added or removed |
| Root is f-node (not d-node) | Treat as single file at path `""` — compare by key |
| Root type mismatch (d-node vs f-node) | Report as `modified` with `typeChange` at root |
| Child key not found in storage | Throw error |
| set-node encountered | Throw error immediately |
| maxDepth reached | Report directory as single `modified` entry |
| maxEntries reached | Stop, set `truncated: true` |

## Package Structure

```
packages/dag-diff/
  package.json
  tsconfig.json
  src/
    index.ts        — public API re-exports
    types.ts        — DiffEntry, DiffResult, MergeResult, etc.
    diff.ts         — dagDiff() batch function + moved detection
    stream.ts       — dagDiffStream() core algorithm
    collect.ts      — collectLeaves() helper for added/removed subtrees
    merge.ts        — dagMerge() 3-way merge with LWW
  tests/
    dag-diff.test.ts
    merge.test.ts
```

Dependencies: `@casfa/core` (decodeNode, hashToKey, well-known keys).

## 3-Way Merge

### Overview

`dagMerge(baseRootKey, oursRootKey, theirsRootKey, options)` computes Operations
to apply to the base tree to produce a merged result from two diverged versions.

### Algorithm

1. Compute `dagDiff(base → ours)` and `dagDiff(base → theirs)` concurrently
2. Index both diffs by path
3. For each affected path, apply merge rules:

| ours ╲ theirs | (none)        | added          | removed       | modified       |
|---------------|---------------|----------------|---------------|----------------|
| (none)        | —             | add(theirs)    | remove        | update(theirs) |
| added         | add(ours)     | LWW if ≠ key   | —             | —              |
| removed       | remove        | —              | remove        | LWW            |
| modified      | update(ours)  | —              | LWW           | LWW if ≠ key   |

### Conflict Resolution: Last-Writer-Wins (LWW)

When both sides changed the same path differently, the version with the
**later timestamp** wins. Tiebreaker: **ours wins** when timestamps are equal.

Three conflict types are tracked in `LwwResolution`:
- `both-added` — both added the same path with different keys
- `both-modified` — both modified the same path to different keys
- `modify-remove` — one side modified, the other removed

### API

```typescript
type MergeOptions = {
  storage: StorageProvider;
  oursTimestamp: number;
  theirsTimestamp: number;
  maxDepth?: number;
  maxEntries?: number;
};

type MergeOp =
  | { type: "add"; path: string; nodeKey: string }
  | { type: "remove"; path: string }
  | { type: "update"; path: string; nodeKey: string };

type MergeResult = {
  operations: MergeOp[];
  resolutions: LwwResolution[];
};

async function dagMerge(
  baseRootKey: string,
  oursRootKey: string,
  theirsRootKey: string,
  options: MergeOptions
): Promise<MergeResult>;
```

### Fast Paths

- All three roots identical → empty merge
- Only one side diverged → that side's diff becomes operations directly
- Both converged to same state → treat as one-side diff

## Non-Goals (Future)

- Byte-level content diff within f-nodes
- Permission / set-node aware diffing
- Rename detection heuristics beyond exact key match
