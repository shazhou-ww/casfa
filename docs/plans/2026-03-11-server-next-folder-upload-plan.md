# server-next 拖拽上传文件夹 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add folder upload (drag-and-drop and picker) with structure preserved, limits (500 files, depth 10, 4MB/file), progress UI, and single-upload-button degradation when folder is unsupported.

**Architecture:** Frontend-only: new helper module `folder-upload.ts` for validation, mkdir ordering, and concurrent upload with progress; `directory-tree.tsx` uses it for drop and for a single upload button that triggers either `webkitdirectory` or `multiple` input; progress state and cancel in component.

**Tech Stack:** React, MUI, existing `createFolder` / `uploadFile` from `fs-api.ts`. Browser APIs: `DataTransferItem.webkitGetAsEntry`, `FileSystemDirectoryEntry`, `File.webkitRelativePath`, `<input webkitdirectory>`.

**Design reference:** `docs/plans/2026-03-11-server-next-folder-upload-design.md`

---

### Task 1: Validation and mkdir path extraction

**Files:**
- Create: `apps/server-next/frontend/lib/folder-upload.ts`
- Create: `apps/server-next/frontend/lib/__tests__/folder-upload.test.ts`

**Step 1: Add types and validateUploadPlan**

In `folder-upload.ts` define:

```ts
export type UploadEntry = { relativePath: string; file: File };

const DEFAULT_LIMITS = { maxFiles: 500, maxDepth: 10, maxFileBytes: 4 * 1024 * 1024 };

export function validateUploadPlan(
  entries: UploadEntry[],
  limits: { maxFiles?: number; maxDepth?: number; maxFileBytes?: number } = {}
): { ok: true } | { ok: false; message: string } {
  const { maxFiles, maxDepth, maxFileBytes } = { ...DEFAULT_LIMITS, ...limits };
  if (entries.length > maxFiles) return { ok: false, message: `超过 ${maxFiles} 个文件` };
  for (const { relativePath, file } of entries) {
    const depth = relativePath.split("/").filter(Boolean).length;
    if (depth > maxDepth) return { ok: false, message: "路径过深" };
    if (file.size > maxFileBytes) return { ok: false, message: `${file.name} 超过 4MB` };
  }
  return { ok: true };
}
```

**Step 2: Add getMkdirPaths**

In same file:

```ts
export function getMkdirPaths(entries: UploadEntry[]): string[] {
  const dirs = new Set<string>();
  for (const { relativePath } of entries) {
    const parts = relativePath.split("/").filter(Boolean);
    parts.pop(); // file name
    for (let i = 0; i < parts.length; i++) dirs.add(parts.slice(0, i + 1).join("/"));
  }
  return Array.from(dirs).sort();
}
```

**Step 3: Write failing tests**

In `folder-upload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateUploadPlan, getMkdirPaths, type UploadEntry } from "../folder-upload";

describe("validateUploadPlan", () => {
  it("rejects when over maxFiles", () => {
    const entries: UploadEntry[] = Array.from({ length: 501 }, (_, i) => ({
      relativePath: `f/file${i}.txt`,
      file: new File(["x"], `file${i}.txt`),
    }));
    expect(validateUploadPlan(entries)).toEqual({ ok: false, message: "超过 500 个文件" });
  });
  it("rejects when path depth > 10", () => {
    const deep = "a/b/c/d/e/f/g/h/i/j/k/file.txt";
    expect(validateUploadPlan([{ relativePath: deep, file: new File(["x"], "file.txt") }])).toEqual({
      ok: false,
      message: "路径过深",
    });
  });
  it("rejects when single file > 4MB", () => {
    const big = new File([new ArrayBuffer(5 * 1024 * 1024)], "big.bin");
    expect(validateUploadPlan([{ relativePath: "big.bin", file: big }])).toEqual({
      ok: false,
      message: "big.bin 超过 4MB",
    });
  });
  it("accepts valid plan", () => {
    expect(validateUploadPlan([{ relativePath: "a/b.txt", file: new File(["x"], "b.txt") }])).toEqual({ ok: true });
  });
});

describe("getMkdirPaths", () => {
  it("returns unique parent dirs sorted", () => {
    const entries: UploadEntry[] = [
      { relativePath: "foo/a/b.txt", file: new File([], "b.txt") },
      { relativePath: "foo/a/c.txt", file: new File([], "c.txt") },
      { relativePath: "foo/d.txt", file: new File([], "d.txt") },
    ];
    expect(getMkdirPaths(entries)).toEqual(["foo", "foo/a"]);
  });
});
```

**Step 4: Run tests**

From `apps/server-next`: `bun test frontend/lib/__tests__/folder-upload.test.ts`  
Expected: PASS (after implementation exists).

**Step 5: Commit**

```bash
git add apps/server-next/frontend/lib/folder-upload.ts apps/server-next/frontend/lib/__tests__/folder-upload.test.ts
git commit -m "feat(server-next): add folder upload validation and getMkdirPaths"
```

---

### Task 2: runUploadWithProgress with cancel

**Files:**
- Modify: `apps/server-next/frontend/lib/folder-upload.ts`
- Modify: `apps/server-next/frontend/lib/__tests__/folder-upload.test.ts`

**Step 1: Add runUploadWithProgress**

In `folder-upload.ts` add:

```ts
export type UploadDeps = {
  createFolder: (parentPath: string, name: string) => Promise<void>;
  uploadFile: (path: string, file: File) => Promise<void>;
};

export type UploadResult = { success: number; failed: number; errors: string[]; cancelled?: boolean };

export async function runUploadWithProgress(
  entries: UploadEntry[],
  basePath: string,
  deps: UploadDeps,
  callbacks: { onProgress: (done: number, total: number) => void; getCancelled?: () => boolean }
): Promise<UploadResult> {
  const normalizedBase = basePath.replace(/^\/+|\/+$/g, "") || "";
  const total = entries.length;
  const errors: string[] = [];
  let done = 0;
  let success = 0;

  const mkdirPaths = getMkdirPaths(entries);
  for (const rel of mkdirPaths) {
    if (callbacks.getCancelled?.()) return { success, failed: errors.length, errors, cancelled: true };
    const parent = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
    const name = rel.includes("/") ? rel.split("/").pop()! : rel;
    const parentFull = normalizedBase ? `${normalizedBase}/${parent}` : parent;
    await deps.createFolder(parentFull || "/", name);
  }

  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const CONCURRENCY = 2;
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < sorted.length && !callbacks.getCancelled?.()) {
      const i = index++;
      const { relativePath, file } = sorted[i]!;
      const fullPath = normalizedBase ? `${normalizedBase}/${relativePath}` : relativePath;
      try {
        await deps.uploadFile(fullPath, file);
        success++;
      } catch (e) {
        errors.push(`${relativePath}: ${e instanceof Error ? e.message : "上传失败"}`);
      }
      done++;
      callbacks.onProgress(done, total);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, runNext));
  return { success, failed: errors.length, errors };
}
```

**Step 2: Add test for runUploadWithProgress**

In test file add test that mocks createFolder/uploadFile, calls runUploadWithProgress with 3 entries, asserts onProgress called with (1,3), (2,3), (3,3) and result success/failed.

**Step 3: Run tests**

`bun test frontend/lib/__tests__/folder-upload.test.ts`  
Expected: PASS.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/lib/folder-upload.ts apps/server-next/frontend/lib/__tests__/folder-upload.test.ts
git commit -m "feat(server-next): add runUploadWithProgress with concurrency and cancel"
```

---

### Task 3: collectFromFileList (webkitRelativePath)

**Files:**
- Modify: `apps/server-next/frontend/lib/folder-upload.ts`
- Modify: `apps/server-next/frontend/lib/__tests__/folder-upload.test.ts`

**Step 1: Add collectFromFileList**

```ts
export function collectFromFileList(files: FileList | File[]): UploadEntry[] {
  const list = Array.from(files);
  return list.map((file) => ({
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
}
```

**Step 2: Add test**

- When File has webkitRelativePath "Folder/a.txt", entry has relativePath "Folder/a.txt".
- When File has no webkitRelativePath, entry has relativePath = file.name (flat).

**Step 3: Run tests and commit**

---

### Task 4: collectFromDrop (DataTransfer, webkitGetAsEntry)

**Files:**
- Modify: `apps/server-next/frontend/lib/folder-upload.ts`

**Step 1: Add collectFromDrop**

Use `dataTransfer.items`, iterate; for each item call `item.webkitGetAsEntry()` if present. If entry is directory, recursively read with `createReader().readEntries()`, for each file entry call `file()` and push `{ relativePath: fullPath, file }`. Build fullPath from entry names. If any directory encountered, return the collected array; if no items or no webkitGetAsEntry, return `null` (caller will use flat files from dataTransfer.files).

Type for entry: `FileSystemEntry` / `FileSystemDirectoryEntry` from TypeScript DOM lib (or extend with `webkitGetAsEntry()` on DataTransferItem).

**Step 2: No unit test** (browser-only API). Optional: export a stub that returns null when items.length === 0 for test harness.

**Step 3: Commit**

```bash
git add apps/server-next/frontend/lib/folder-upload.ts
git commit -m "feat(server-next): add collectFromDrop for folder drag"
```

---

### Task 5: Directory-tree — single upload button with two inputs

**Files:**
- Modify: `apps/server-next/frontend/components/explorer/directory-tree.tsx`

**Step 1: Detect webkitdirectory and add second input**

- `const supportsFolder = typeof document !== "undefined" && "webkitdirectory" in document.createElement("input");`
- Add second ref: `inputFolderRef = useRef<HTMLInputElement>(null)`.
- Keep existing `fileInputRef` for files-only.
- Upload button onClick: `if (supportsFolder) inputFolderRef.current?.click(); else fileInputRef.current?.click();`

**Step 2: Add second input element**

- `<input type="file" ref={inputFolderRef} webkitdirectory multiple style={{ display: "none" }} onChange={handleFolderSelect} />`
- Implement `handleFolderSelect`: get `files` from input, call `collectFromFileList(files)`. If entries have any path containing "/", treat as folder upload: validate with `validateUploadPlan`, then if empty-folder case (0 files but can derive folder name from first webkitRelativePath segment), call `createFolder(currentPath, folderName)` and snackbar; else call `runUploadWithProgress` with progress state and cancel ref. If no "/" in any path, call existing `doUploadFiles(Array.from(files))`.

**Step 3: Wire progress state**

- State: `uploadProgress: { total: number; done: number } | null` and `cancelUploadRef = useRef(false)`.
- When starting folder upload set `cancelUploadRef.current = false`, set `uploadProgress({ total, done: 0 })`. In onProgress set `uploadProgress({ total, done })`. When getCancelled is true (user clicked Cancel), set `cancelUploadRef.current = true`. On complete clear `uploadProgress`, refresh list, show snackbar.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/components/explorer/directory-tree.tsx
git commit -m "feat(server-next): single upload button with folder picker and progress"
```

---

### Task 6: Directory-tree — drop uses folder-aware collect

**Files:**
- Modify: `apps/server-next/frontend/components/explorer/directory-tree.tsx`

**Step 1: In handleDrop, try collectFromDrop first**

- `const folderEntries = await collectFromDrop(e.dataTransfer);`
- If `folderEntries !== null && folderEntries.length > 0`: run same validation + runUploadWithProgress (and empty-folder handling) as in Task 5.
- Else: use `e.dataTransfer.files` and existing `doUploadFiles(files)` (current behavior).
- If folderEntries !== null but length === 0, check for single top-level dir name from drop (e.g. from first item’s entry.name if it was a directory); if present, createFolder and snackbar.

**Step 2: Ensure doUploadFiles also respects 500 / 4MB and can show progress**

- Option: when doUploadFiles is used with many files, set uploadProgress and onProgress so progress bar shows for flat upload too; or keep current behavior (no progress for flat) per design. Design says "可与文件夹上传共用同一套进度与上限校验" — so add validateUploadPlan for flat list (entries with relativePath = file.name), reject if > 500 or any file > 4MB, and optionally show progress for flat upload. Simplest: only show progress when total > 1 and we have folder structure; for flat, keep current snackbar-only. Or unify: always set uploadProgress when uploading multiple files (from drop or picker). Implementer choice: prefer unifying progress for any multi-file upload.

**Step 3: Commit**

```bash
git add apps/server-next/frontend/components/explorer/directory-tree.tsx
git commit -m "feat(server-next): drop uses folder-aware collect and validation"
```

---

### Task 7: Progress UI and Cancel button

**Files:**
- Modify: `apps/server-next/frontend/components/explorer/directory-tree.tsx`

**Step 1: Render progress bar and cancel**

- When `uploadProgress !== null && uploadProgress.done < uploadProgress.total`: show a bar below toolbar (e.g. `<LinearProgress variant="determinate" value={(done/total)*100} />` and text "正在上传 {done}/{total}" and a "取消" button that sets `cancelUploadRef.current = true`).
- On completion (success or cancel), set `uploadProgress = null`, `setRefreshKey(k=>k+1)`, snackbar with result.

**Step 2: Commit**

```bash
git add apps/server-next/frontend/components/explorer/directory-tree.tsx
git commit -m "feat(server-next): progress bar and cancel for folder upload"
```

---

### Task 8: Empty folder — create folder by name

**Files:**
- Modify: `apps/server-next/frontend/components/explorer/directory-tree.tsx`
- Modify: `apps/server-next/frontend/lib/folder-upload.ts` (if needed to export a helper for "get folder name from entries or from drop")

**Step 1: Empty folder from picker**

- When `handleFolderSelect` gets entries from `collectFromFileList`, if entries.length === 0 but files.length > 0 we have a folder selection with no files — get folder name from first file’s webkitRelativePath split by "/"[0]. If entries.length === 0 and we can get folder name (e.g. from input’s path or first empty dir), call `createFolder(currentPath, folderName)` and snackbar "已创建文件夹 xxx".

**Step 2: Empty folder from drop**

- When `collectFromDrop` returns [] (only directories, no files), we may have one or more top-level dir names from the DataTransferItem entries. In handleDrop, if folderEntries !== null && folderEntries.length === 0, try to get a single directory name (e.g. from first item.webkitGetAsEntry() that is a directory — use its name). Then createFolder(currentPath, name) and snackbar. If we dropped multiple empty folders, we could create the first one only, or loop; design says "创建同名文件夹" — one name suffices for single empty folder.

**Step 3: Commit**

```bash
git add apps/server-next/frontend/components/explorer/directory-tree.tsx apps/server-next/frontend/lib/folder-upload.ts
git commit -m "feat(server-next): empty folder creates directory by name"
```

---

### Task 9: Manual test checklist and docs

**Files:**
- Modify: `docs/plans/2026-03-11-server-next-folder-upload-design.md` (add "Implemented by: 2026-03-11-server-next-folder-upload-plan.md")

**Step 1: Run full test suite**

From repo root or apps/server-next: `cell test` or `bun test`. Ensure no regressions.

**Step 2: Manual checks (in browser)**

- Drag folder with nested dirs → structure preserved, progress shows, success.
- Drag multiple files → same as before (flat), optional progress.
- Click Upload, choose folder (Chrome) → folder structure uploaded.
- Click Upload in Safari (no webkitdirectory?) → only files selectable.
- > 500 files or depth > 10 or file > 4MB → rejected with clear message.
- Empty folder → one directory created with that name.
- Cancel during upload → progress clears, partial files remain.

**Step 3: Commit**

```bash
git add docs/plans/2026-03-11-server-next-folder-upload-design.md
git commit -m "docs: link folder-upload design to implementation plan"
```

---

## Execution options

Plan complete and saved to `docs/plans/2026-03-11-server-next-folder-upload-plan.md`.

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with executing-plans in the same worktree, batch execution with checkpoints.

Which approach do you prefer?
