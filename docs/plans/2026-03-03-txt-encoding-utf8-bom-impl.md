# Text file UTF-8 BOM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepend UTF-8 BOM to text file content when writing **via MCP fs_write only** for text/* content types, so browser preview/download shows Chinese correctly. REST upload does not modify content.

**Architecture:** In fs_write handler only, after encoding content to bytes, if contentType starts with "text/", prepend 0xEF 0xBB 0xBF then pass to encodeFileNode. REST files.upload stores body as-is.

**Tech Stack:** Bun, server-next backend (Hono). Design: `docs/plans/2026-03-03-txt-encoding-utf8-bom-design.md`.

---

## Task 1: MCP fs_write — prepend BOM for text/*

**Files:**
- Modify: `apps/server-next/backend/mcp/handler.ts`

**Step 1: Add BOM constant and conditional prepend**

In the `fs_write` branch (around where `const bytes = new TextEncoder().encode(content)` is), after computing `bytes` and before the MAX_BYTES check:

- Define `const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);`
- If `contentType.startsWith("text/")`, replace the data used for encoding with a new Uint8Array that is `[BOM, ...bytes]` (e.g. `data = new Uint8Array(UTF8_BOM.length + bytes.length); data.set(UTF8_BOM); data.set(bytes, UTF8_BOM.length);`), and use `data` (and `data.length`) for the size check and for `encodeFileNode`. Otherwise keep using `bytes`.

**Step 2: Run backend tests**

Run: `cd apps/server-next && bun test tests/mcp.test.ts` (or `bun test backend` if that runs MCP tests).  
Expected: existing tests pass; if env returns 401, run typecheck instead: `cd apps/server-next/backend && bun run typecheck` or `bun test backend/__tests__` for unit tests.

**Step 3: Commit**

```bash
git add apps/server-next/backend/mcp/handler.ts
git commit -m "feat(server-next): prepend UTF-8 BOM for text/* in MCP fs_write"
```

---

## Task 2: E2E or manual verification

**Step 1: Verify BOM in written file**

- Use MCP `fs_write` to write a file with Chinese (e.g. path `aranya/修改说明.txt`, content with Chinese).
- Use MCP `fs_read` or GET `/api/realm/:realmId/files/aranya/修改说明.txt` and assert first 3 bytes are `0xEF 0xBB 0xBF`, and decoded text is correct.
- Open the file URL in browser; confirm no garbled characters.

**Step 2: Commit (if any test file added)**

If an E2E test was added: `git add ... && git commit -m "test(server-next): verify UTF-8 BOM in fs_write text files"`.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-03-txt-encoding-utf8-bom-impl.md`.

Two execution options:

1. **Subagent-Driven (this session)** — I execute task-by-task in this session with review.
2. **Parallel session** — Open new session with executing-plans in (optional) worktree.

Which approach?
