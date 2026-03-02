# Local Integration (Option 3) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One-command local dev (API 7101 + frontend 7100) with mock auth by default and optional `dev:cognito`; frontend calls `/api/me` then `/api/realm/:realmId/files`, mapping backend `entries` to FsEntry.

**Architecture:** Root `dev` script runs serverless-offline and frontend Vite in parallel (concurrently); backend exposes `/api/dev/mock-token` only when `MOCK_JWT_SECRET` is set and verifies mock JWTs with that secret; frontend uses `/api/info` to choose mock vs Cognito, then mock-token or Cognito token for all `/api/*` requests, and replaces `/api/fs/entries` with realm-based file API.

**Tech Stack:** Bun, serverless-offline, Vite, Hono, jose (JWT), concurrently.

**Design reference:** `docs/plans/2026-03-02-local-integration-design.md`

---

### Task 1: Add concurrently and dev script (API + frontend, mock)

**Files:**
- Modify: `apps/server-next/package.json`
- Modify: `apps/server-next/scripts/dev.ts` (add MOCK_JWT_SECRET default in env)
- Create: `apps/server-next/scripts/dev-cognito.ts`

**Step 1: Add devDependency**

Add `"concurrently": "^9.x"` (or current major) to devDependencies. Run from repo root: `cd apps/server-next && bun add -d concurrently --no-cache`.

**Step 2: Change dev script**

Replace current `"dev": "bun run scripts/dev.ts"` with a single command that runs in parallel: (1) serverless offline on 7101 via `scripts/dev.ts`, (2) frontend dev on 7100. In `scripts/dev.ts`, ensure env passed to the child includes `MOCK_JWT_SECRET: process.env.MOCK_JWT_SECRET ?? "dev-mock-secret"` so that default dev uses mock.

Example (adjust for Windows if needed):

```json
"dev": "concurrently -n api,web -c blue,green \"bun run scripts/dev.ts\" \"bun run --cwd frontend dev\"",
```

**Step 3: Add dev:cognito script**

Create `scripts/dev-cognito.ts` that spawns serverless offline with the same ports and env as dev.ts but **does not** set `MOCK_JWT_SECRET` (pass through `process.env` only). Add to package.json:

```json
"dev:cognito": "concurrently -n api,web -c blue,green \"bun run scripts/dev-cognito.ts\" \"bun run --cwd frontend dev\""
```

**Step 4: Verify**

Run from `apps/server-next`: `bun run dev`. Expect API on 7101 and frontend on 7100; GET `http://localhost:7101/api/info` should return `authType: "mock"`.

**Step 5: Commit**

```bash
git add apps/server-next/package.json apps/server-next/scripts/dev.ts
# If new file: apps/server-next/scripts/dev-cognito.ts
git commit -m "chore(server-next): one-command dev with mock, add dev:cognito"
```

---

### Task 2: Backend GET /api/dev/mock-token (only when MOCK_JWT_SECRET set)

**Files:**
- Create: `apps/server-next/backend/controllers/dev-mock-token.ts`
- Modify: `apps/server-next/backend/app.ts`

**Step 1: Implement mock-token controller**

Create `apps/server-next/backend/controllers/dev-mock-token.ts` that:
- Exports a factory `createDevMockTokenController(deps: { config: ServerConfig })`.
- In handler: if `!deps.config.auth.mockJwtSecret` return 404. Otherwise sign a JWT with payload `{ sub: string, email?: string, name?: string }` (e.g. sub = "dev-user" or from env), using `deps.config.auth.mockJwtSecret`, with jose `SignJWT` and `new Secret(new TextEncoder().encode(secret))`. Return JSON `{ token: string }`.

Use short expiry (e.g. 24h) for dev.

**Step 2: Register route only when mock**

In `app.ts`, after `/api/info`, add:

- If `deps.config.auth.mockJwtSecret`: `app.get("/api/dev/mock-token", (c) => devMockToken.get(c));` (and optionally POST). Inject `createDevMockTokenController` with `{ config: deps.config }`.

**Step 3: Manual test**

With `bun run dev`, GET `http://localhost:7101/api/dev/mock-token` should return `{ token: "eyJ..." }`. With dev:cognito (no MOCK_JWT_SECRET), GET same URL should 404.

**Step 4: Commit**

```bash
git add apps/server-next/backend/controllers/dev-mock-token.ts apps/server-next/backend/app.ts
git commit -m "feat(server-next): add GET /api/dev/mock-token when MOCK_JWT_SECRET set"
```

---

### Task 3: Backend auth middleware: verify mock JWT with MOCK_JWT_SECRET

**Files:**
- Modify: `apps/server-next/backend/middleware/auth.ts`

**Step 1: Use jose to verify when mock**

When `deps.config?.auth?.mockJwtSecret` is set, use `jose.jwtVerify(token, new jose.Secret(new TextEncoder().encode(deps.config.auth.mockJwtSecret)))` instead of the current mockJwtVerify that only decodes. Extract payload and set auth context as today (user with userId = sub). Reject invalid or expired tokens with 401.

**Step 2: Keep Cognito and branch-token logic unchanged**

Cognito path and branch-token decoding remain as-is.

**Step 3: Manual test**

With `bun run dev`, get token from `/api/dev/mock-token`, then GET `http://localhost:7101/api/me` with `Authorization: Bearer <token>`. Expect 200 and body with userId. Without token or with wrong token, expect 401.

**Step 4: Commit**

```bash
git add apps/server-next/backend/middleware/auth.ts
git commit -m "feat(server-next): verify mock JWT with MOCK_JWT_SECRET in auth middleware"
```

---

### Task 4: Frontend auth: /api/info + mock-token when authType is mock

**Files:**
- Create or Modify: `apps/server-next/frontend/src/lib/auth.ts` (or existing auth/store)
- Modify: components/pages that need token (e.g. explorer, or a root provider)

**Step 1: Fetch auth type and token**

- On app load (or before first API call), GET `/api/info`. If `authType === "mock"`, GET `/api/dev/mock-token`, store token (e.g. in memory or sessionStorage). If `authType === "cognito"`, use existing Cognito flow (or placeholder “please log in” until Cognito is wired).
- Expose a way for the rest of the app to get the current token (e.g. store or context) so all `/api/*` requests can attach `Authorization: Bearer <token>`.

**Step 2: Attach Bearer to fetch**

Ensure all API calls (e.g. in fs-api and any future API module) use the same token. Either a central fetch wrapper that adds the header, or pass token into fs-api. Prefer a small auth store (e.g. zustand) that holds token and a function `getToken()` used by API helpers.

**Step 3: Verify**

With `bun run dev`, open frontend at 7100; in Network tab confirm first request to `/api/info`, then to `/api/dev/mock-token`, then to `/api/me` with Bearer. No 401 on /api/me.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/lib/auth.ts [and any modified callers]
git commit -m "feat(server-next): frontend auth via /api/info and mock-token when mock"
```

---

### Task 5: Frontend fs-api: /api/me → realmId, then /api/realm/:realmId/files, map to FsEntry

**Files:**
- Modify: `apps/server-next/frontend/src/lib/fs-api.ts`
- Modify: `apps/server-next/frontend/src/types/api.ts` (if needed; FsEntry already has path, isDirectory, size)

**Step 1: Replace fetchList implementation**

- Remove the branch that calls `/api/fs/entries`.
- When not using local mock data (see Task 6): get realmId once (e.g. from /api/me response, or from auth store that cached it after /api/me). Then:
  - If path is "" or "/", request `GET /api/realm/${realmId}/files`.
  - Else request `GET /api/realm/${realmId}/files/${path}` (path without leading slash).
- Parse response `{ entries: [ { name, kind, size? } ] }`. Map each entry to FsEntry:
  - `name` → name
  - path: if current path is "" or "/", then `"/" + name`, else `path + "/" + name` (normalize slashes)
  - `isDirectory: entry.kind === "directory"`
  - `size`: entry.size

**Step 2: Ensure auth**

All requests must send `Authorization: Bearer <token>` (from Task 4). Pass token into fetchList or use the central wrapper.

**Step 3: Manual test**

With `bun run dev`, open explorer; confirm list loads from backend (root or a folder). Check Network: `/api/me`, then `/api/realm/<realmId>/files` or `/files/...`.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/lib/fs-api.ts apps/server-next/frontend/src/types/api.ts
git commit -m "feat(server-next): frontend fs-api uses /api/me and /api/realm/:realmId/files, map entries to FsEntry"
```

---

### Task 6: Frontend remove /api/fs/entries and useMock branching

**Files:**
- Modify: `apps/server-next/frontend/src/lib/fs-api.ts`
- Modify: `apps/server-next/frontend/src/components/explorer/directory-tree.tsx`
- Modify: `apps/server-next/frontend/src/pages/explorer-page.tsx`

**Step 1: Remove useMock and mock data path**

In `fs-api.ts`, remove the `useMock` parameter and the branch that returns `MOCK_ENTRIES_ROOT` or static mock entries. Single code path: get realmId (from cache or /api/me), then call realm files API and map to FsEntry.

**Step 2: Update callers**

In `directory-tree.tsx` and `explorer-page.tsx`, remove `useMock` prop and any references. Call `fetchList(path)` (or the new signature that takes path only and uses stored realmId/token).

**Step 3: Verify**

`bun run dev`: explorer loads from backend only. No requests to `/api/fs/entries`.

**Step 4: Commit**

```bash
git add apps/server-next/frontend/src/lib/fs-api.ts apps/server-next/frontend/src/components/explorer/directory-tree.tsx apps/server-next/frontend/src/pages/explorer-page.tsx
git commit -m "refactor(server-next): remove useMock and /api/fs/entries, use realm files API only"
```

---

### Task 7: 401 handling and doc update

**Files:**
- Modify: `apps/server-next/frontend/src/` (wherever API calls are made or a global error handler exists)
- Modify: `docs/plans/2026-03-02-casfa-next-engineering-design.md`

**Step 1: 401 handling**

On any API response 401: if authType is mock, try refreshing token once (GET `/api/dev/mock-token`) and retry; if still 401 or authType is cognito, show “请重新登录” or “Unauthorized” and optionally redirect to login.

**Step 2: Doc**

In engineering design “第四节：本地 dev / test 流程” add one sentence: local-dev 默认 `bun run dev` 使用 mock 鉴权，`bun run dev:cognito` 使用 Cognito；端口与其余约定不变。

**Step 3: Commit**

```bash
git add [frontend 401 handling files] docs/plans/2026-03-02-casfa-next-engineering-design.md
git commit -m "feat(server-next): 401 handling and doc update for dev vs dev:cognito"
```

---

## Execution

Plan complete and saved to `docs/plans/2026-03-02-local-integration-impl.md`. Two execution options:

1. **Subagent-Driven (this session)** – Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** – Open a new session with executing-plans and run through the plan with checkpoints.

Which approach do you prefer?
