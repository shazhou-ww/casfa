# File Upload (UI + MCP) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add file upload in server-next: UI (button + drag-drop) calling existing PUT /files/:path, and MCP tool fs_write for text-only writes (path, content, optional contentType).

**Architecture:** UI extends existing DirectoryTree and fs-api; MCP adds one tool reusing files.upload logic (encodeFileNode → addOrReplaceAtPath → setBranchRoot). No new backend routes; frontend adds uploadFile() and upload UI.

**Tech Stack:** Hono, React, MUI, Bun test. Design: `docs/plans/2026-03-03-file-upload-ui-mcp-design.md`.

---

## Task 1: fs-api uploadFile

**Files:**
- Modify: `apps/server-next/frontend/src/lib/fs-api.ts`

**Step 1: Add uploadFile function**

```ts
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Upload a file to the given path (path must include file name).
 * Uses PUT /api/realm/:realmId/files/:path. Max 4MB per file.
 */
export async function uploadFile(path: string, file: File): Promise<void> {
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) throw new Error("Not authenticated");
  const normalized = normalizePath(path);
  if (!normalized) throw new Error("Path must include file name");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`);
  }
  const url = `/api/realm/${realmId}/files/${normalized}`;
  const res = await apiFetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Upload failed");
  }
}
```

`normalizePath` is already defined in the same file (used by deletePath/movePath). Ensure it strips leading/trailing slashes and normalizes segments; path for upload must include the file name (e.g. "foo/bar.txt").

**Step 2: Run frontend build**

Run: `cd apps/server-next/frontend && bun run build`  
Expected: success.

**Step 3: Commit**

```bash
git add apps/server-next/frontend/src/lib/fs-api.ts
git commit -m "feat(server-next): add uploadFile to fs-api"
```

---

## Task 2: DirectoryTree upload button and handler

**Files:**
- Modify: `apps/server-next/frontend/src/components/explorer/directory-tree.tsx`

**Step 1: Add upload imports and state**

- Add to imports: `CloudUploadIcon` from `@mui/icons-material/CloudUpload`, and `uploadFile` from `../../lib/fs-api`.
- Add state: `const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null)` and optionally `uploadingCount` or a single `uploading` boolean for disabling toolbar during upload.
- Add ref for hidden input: `<input type="file" multiple ref={(el) => setFileInputRef(el)} style={{ display: 'none' }} />` (place near Toolbar).

**Step 2: Add upload button and change handler**

- In Toolbar, add a Button before "新建文件夹": "上传" with CloudUpload icon, onClick: `() => fileInputRef?.click()`.
- Add `<input type="file" multiple ref={...} style={{ display: 'none' }} onChange={handleFileSelect} />`.
- Implement handleFileSelect: get `currentPath`, for each file build path = currentPath (normalized) + '/' + file.name; if file.size > 4MB skip and setSnackbar error for that file; else await uploadFile(fullPath, file). After all, setRefreshKey(k => k+1) and setSnackbar success. Use try/catch and setSnackbar on failure. Clear input value after so same file can be re-selected.

**Step 3: Verify**

Run: `cd apps/server-next/frontend && bun run build`  
Expected: success.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/components/explorer/directory-tree.tsx
git commit -m "feat(server-next): add upload button to file explorer"
```

---

## Task 3: Drag-drop overlay

**Files:**
- Modify: `apps/server-next/frontend/src/components/explorer/directory-tree.tsx`

**Step 1: Add drag state and ref**

- State: `const [dragOver, setDragOver] = useState(false)` and `const dragCountRef = useRef(0)`.
- Handlers: onDragEnter (e) { e.preventDefault(); dragCountRef.current++; setDragOver(true); }, onDragLeave (e) { e.preventDefault(); dragCountRef.current = Math.max(0, dragCountRef.current - 1); if (dragCountRef.current === 0) setDragOver(false); }, onDragOver (e) { e.preventDefault(); }, onDrop (e) { e.preventDefault(); setDragOver(false); dragCountRef.current = 0; const files = e.dataTransfer?.files; if (files?.length) { /* same as handleFileSelect */ } }.
- Wrap the list Box in a Box with these onDragEnter/Leave/Over/Drop. When dragOver, render overlay: position absolute, inset 0, bg alpha 0.9, border dashed, "释放以上传" text.

**Step 2: Reuse upload logic**

- Extract a function `async function doUploadFiles(files: File[]) { ... }` that takes currentPath, loops files, validates size, calls uploadFile, then setRefreshKey and setSnackbar. Call it from both handleFileSelect and onDrop.

**Step 3: Build and commit**

Run: `cd apps/server-next/frontend && bun run build`  
Then: `git add directory-tree.tsx && git commit -m "feat(server-next): add drag-drop upload overlay to file explorer"`

---

## Task 4: MCP fs_write tool definition and handler

**Files:**
- Modify: `apps/server-next/backend/mcp/handler.ts`

**Step 1: Add fs_write to MCP_TOOLS**

In the MCP_TOOLS array, add (e.g. after fs_cp):

```ts
  {
    name: "fs_write",
    description: "Write a text file at the given path (UTF-8). Creates or overwrites. Single file ≤4MB. Text content only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path including file name" },
        content: { type: "string" as const, description: "Text content (UTF-8)" },
        contentType: { type: "string" as const, description: "Optional; default text/plain (e.g. text/markdown, application/json)" },
      },
      required: ["path", "content"] as string[],
    },
  },
```

**Step 2: Add fs_write case in handleToolsCall**

After the fs_cp block (and before the "fs_ls, fs_stat, fs_read" block), add:

- If name === "fs_write": check hasFileWrite(auth); get path (trim, normalize), content (string), contentType (string or default "text/plain"). Validate path not empty. Encode content with TextEncoder to Uint8Array; if length > 4*1024*1024 return mcpError MCP_INVALID_PARAMS "Content too large (max 4MB)". Get rootKey = getCurrentRoot(auth, deps); if null return "Realm not initialized...". Import encodeFileNode from @casfa/core and streamFromBytes from @casfa/cas (already there). Then: encoded = await encodeFileNode({ data: bytes, fileSize: bytes.length, contentType }, deps.key); fileNodeKey = hashToKey(encoded.hash); await deps.cas.putNode(fileNodeKey, streamFromBytes(encoded.bytes)); recordNewKey if present; newRootKey = await addOrReplaceAtPath(deps.cas, deps.key, rootKey, pathStr, fileNodeKey, onNodePut); delegateId = getEffectiveDelegateId(auth, deps); await deps.branchStore.setBranchRoot(delegateId, newRootKey); return mcpSuccess with { path: pathStr }.

**Step 3: Add encodeFileNode import**

At top: add `encodeFileNode` to the import from `@casfa/core` (encodeDictNode, hashToKey already there).

**Step 4: Run backend tests**

Run: `cd apps/server-next && bun test tests/mcp.test.ts`  
Expected: existing tests pass (fs_write not yet called in tests).

**Step 5: Commit**

```bash
git add apps/server-next/backend/mcp/handler.ts
git commit -m "feat(server-next): add MCP tool fs_write for text files"
```

---

## Task 5: MCP E2E test for fs_write

**Files:**
- Modify: `apps/server-next/tests/mcp.test.ts`

**Step 1: Add fs_write test**

Add a test that: creates user token; calls tools/call with name "fs_write", arguments { path: "hello.txt", content: "Hello MCP" }; expects status 200 and result.content[0].text to be JSON with path "hello.txt". Then calls fs_read with path "hello.txt" and expects content "Hello MCP" (and optionally contentType).

Note: tools/call params shape is { name: "fs_write", arguments: { path: "hello.txt", content: "Hello MCP" } }. Response result.content is array of { type: "text", text: "..." }.

**Step 2: Run test**

Run: `cd apps/server-next && bun test tests/mcp.test.ts`  
Expected: new test passes.

**Step 3: Commit**

```bash
git add apps/server-next/tests/mcp.test.ts
git commit -m "test(server-next): e2e MCP fs_write and fs_read"
```

---

## Task 6: Optional — E2E for UI upload via API

**Files:**
- Modify: `apps/server-next/tests/files.test.ts` (or keep as-is if upload already covered)

**Step 1: Confirm existing upload test**

The design says "现有 files.test.ts 已有 upload 用例". Ensure there is an test that PUTs a file and then lists or stats. If not, add: PUT a file at a path, then GET list (or stat) and assert the file appears.

**Step 2: Run**

Run: `cd apps/server-next && bun test tests/files.test.ts`  
Expected: pass.

**Step 3: Commit (if changed)**

```bash
git add apps/server-next/tests/files.test.ts
git commit -m "test(server-next): ensure file upload and list coverage"
```

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-03-file-upload-ui-mcp-impl.md`.

Two execution options:

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — Open a new session with executing-plans in the same (or worktree) repo and run the plan task-by-task with checkpoints.

Which approach do you want?
