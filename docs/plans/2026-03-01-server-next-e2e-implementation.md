# server-next E2E Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add e2e tests for server-next that start the app in-memory in-process and cover smoke, User file CRUD, Delegate assign + access, Worker branch token + fs/branches, and MCP endpoints.

**Architecture:** Single shared HTTP server started once per e2e run via `Bun.serve({ fetch: app.fetch, port: 0 })` with deps built the same way as `index.ts` (memory storage, mock JWT). Tests use unique `realmId` per test for isolation. Helpers in `e2e/setup.ts` provide `createUserToken`, `authRequest`, `assignDelegate`, `createBranch`, `mcpRequest`.

**Tech Stack:** Bun test runner, Hono app, in-memory stores (@casfa/realm createMemoryDelegateStore, server-next createMemoryDelegateGrantStore/createMemoryDerivedDataStore, createCasFacade with memory storage).

**Reference:** [2026-03-01-server-next-e2e-design.md](./2026-03-01-server-next-e2e-design.md)

---

## Task 1: E2E setup and startTestServer

**Files:**
- Create: `apps/server-next/e2e/setup.ts`

**Step 1: Set env and implement startTestServer**

In `apps/server-next/e2e/setup.ts`:
- Set `process.env.STORAGE_TYPE ??= "memory"` and `process.env.MOCK_JWT_SECRET ??= "test-secret-e2e"` at top level.
- Import `loadConfig` from `../src/config.ts`, `createApp` from `../src/app.ts`, `createCasFacade` from `../src/services/cas.ts`, `createRealmFacadeFromConfig` from `../src/services/realm.ts`, `createMemoryDelegateGrantStore` from `../src/db/delegate-grants.ts`, `createMemoryDerivedDataStore` from `../src/db/derived-data.ts`, `createMemoryDelegateStore` from `@casfa/realm`.
- Implement `startTestServer(options?: { port?: number })`: build config via loadConfig(), then cas/key via createCasFacade(config), delegateStore via createMemoryDelegateStore(), realm via createRealmFacadeFromConfig(cas, key, config, delegateStore), delegateGrantStore, derivedDataStore; createApp(deps); call `Bun.serve({ fetch: app.fetch, port: options?.port ?? 0 })`; return `{ url: \`http://localhost:${server.port}\`, stop: () => server.stop(), helpers }`.
- Helpers object: `createUserToken(realmId: string)` — use same JWT signing as auth middleware expects (e.g. jose or simple sign with MOCK_JWT_SECRET, sub = realmId), return token string. `authRequest(token, method, path, body?)` — fetch url+path with Authorization Bearer token, optional JSON body. Leave `assignDelegate`, `createBranch`, `mcpRequest` as stubs that throw "not implemented" for now.

**Step 2: Export context factory**

Export `createE2EContext()` that returns an object with: `serverPromise = getOrCreateServer()` (cached singleton startTestServer()), `ready: () => serverPromise`, `get baseUrl()` from server.url, `get helpers()` from server.helpers, `cleanup: () => server.stop()`. Use a single cached server instance (let cachedServer: ReturnType<typeof startTestServer> | null = null; getOrCreateServer() creates once and caches).

**Step 3: Verify setup loads**

Run: `cd apps/server-next && bun run typecheck`
Expected: PASS (setup.ts imports from src and compiles).

**Step 4: Commit**

```bash
git add apps/server-next/e2e/setup.ts
git commit -m "chore(server-next): add e2e setup and startTestServer" -m "In-memory deps, createUserToken, authRequest; shared server singleton."
```

---

## Task 2: Health and smoke tests

**Files:**
- Create: `apps/server-next/e2e/health.test.ts`

**Step 1: Write health and smoke tests**

In `apps/server-next/e2e/health.test.ts`:
- Import `beforeAll`, `afterAll`, `describe`, `expect`, `it` from `bun:test`, and `createE2EContext` from `./setup.ts`.
- describe("Health and smoke"): beforeAll create context and await ctx.ready(); afterAll ctx.cleanup().
- it("GET /api/health returns 200 and ok: true"): fetch(ctx.baseUrl + "/api/health"), expect status 200, expect (await response.json()).ok === true.
- it("GET /api/info returns 200 and storageType/authType"): fetch /api/info, expect 200, body has storageType and authType.
- it("GET unknown path returns 404 and error body"): fetch ctx.baseUrl + "/nonexistent", expect 404, body error "NOT_FOUND", message "Not found".
- it("GET /api/realm/me without Authorization returns 401"): fetch /api/realm/me no headers, expect 401, body error "UNAUTHORIZED".
- Optional: it("OPTIONS returns CORS headers"): OPTIONS request, expect Access-Control-Allow-Origin and Allow-Methods in headers.

**Step 2: Run e2e (only health file)**

Run: `cd apps/server-next && bun test e2e/health.test.ts`
Expected: All tests pass (server starts once, tests hit same url).

**Step 3: Commit**

```bash
git add apps/server-next/e2e/health.test.ts
git commit -m "test(server-next): e2e health and smoke"
```

---

## Task 3: Implement createUserToken (JWT) in setup

**Files:**
- Modify: `apps/server-next/e2e/setup.ts`
- Reference: `apps/server-next/src/middleware/auth.ts` (how JWT is verified / what payload is expected)

**Step 1: Implement JWT signing in createUserToken**

The server's mock verifier (auth.ts) only base64-decodes the JWT payload and does not verify the signature. So in setup, implement createUserToken(realmId) by building a minimal JWT: header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), payload = base64url(JSON.stringify({ sub: realmId, exp: Math.floor(Date.now()/1000) + 3600 })), signature = base64url("e2e"); return `${header}.${payload}.${signature}`. No extra dependency needed.

**Step 2: Run health tests again**

Run: `cd apps/server-next && bun test e2e/health.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/server-next/e2e/setup.ts package.json
git commit -m "chore(server-next): e2e createUserToken JWT signing"
```

---

## Task 4: assignDelegate and createBranch helpers

**Files:**
- Modify: `apps/server-next/e2e/setup.ts`

**Step 1: Implement assignDelegate**

`assignDelegate(userToken: string, realmId: string, options?: { client_id?: string; ttl?: number })`: authRequest(userToken, "POST", `/api/realm/${realmId}/delegates/assign`, { client_id: options?.client_id, ttl: options?.ttl }). Parse JSON; if !response.ok throw with status and body; return { accessToken, delegateId, expiresAt } from body.

**Step 2: Implement createBranch**

`createBranch(userToken: string, realmId: string, body: { mountPath: string; ttl?: number })`: authRequest(userToken, "POST", `/api/realm/${realmId}/branches`, body). Parse JSON; if !response.ok throw; return { branchId, accessToken, expiresAt } from body.

**Step 3: Implement mcpRequest**

`mcpRequest(token: string, method: string, params?: unknown)`: POST url + "/api/mcp", Authorization Bearer token, body JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }). Return response.

**Step 4: Run health e2e**

Run: `cd apps/server-next && bun test e2e/health.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server-next/e2e/setup.ts
git commit -m "chore(server-next): e2e assignDelegate, createBranch, mcpRequest"
```

---

## Task 5: Files e2e (User path)

**Files:**
- Create: `apps/server-next/e2e/files.test.ts`

**Step 1: Write files tests**

- describe("Files (User)"): beforeAll ctx = createE2EContext(), await ctx.ready(); afterAll ctx.cleanup(). Use realmId = "e2e-" + crypto.randomUUID().
- it("list root returns empty or entries"): token = helpers.createUserToken(realmId); authRequest(token, "GET", `/api/realm/${realmId}/files`); expect 200; body.entries is array.
- it("mkdir then list shows dir"): same realmId; POST /api/realm/:realmId/fs/mkdir with body { path: "foo" }; then GET files with path or list root; expect 200 and entries include or path exists.
- it("upload file then stat and get content"): PUT /api/realm/:realmId/files/bar.txt with body "hello" and Content-Type text/plain (or small binary); then GET .../files/bar.txt?meta=1 for stat, expect kind "file"; GET .../files/bar.txt without meta for download, expect body text "hello".
- Adjust paths to match server-next API: list is GET /api/realm/:realmId/files (path empty for root), mkdir is POST .../fs/mkdir body { path }, upload is PUT .../files/*path.

**Step 2: Run files e2e**

Run: `cd apps/server-next && bun test e2e/files.test.ts`
Expected: All pass (fix any path or body shape to match app).

**Step 3: Commit**

```bash
git add apps/server-next/e2e/files.test.ts
git commit -m "test(server-next): e2e User files list, mkdir, upload, stat, download"
```

---

## Task 6: Delegates e2e

**Files:**
- Create: `apps/server-next/e2e/delegates.test.ts`

**Step 1: Write delegate tests**

- describe("Delegates"): beforeAll ctx, ctx.ready(), afterAll cleanup. realmId = "e2e-" + crypto.randomUUID().
- it("assign returns accessToken"): token = createUserToken(realmId); result = await helpers.assignDelegate(token, realmId); expect result.accessToken and result.delegateId.
- it("delegate token can list realm files"): same; assign; then authRequest(accessToken, "GET", `/api/realm/${realmId}/files`); expect 200.
- it("delegate token can list branches"): authRequest(accessToken, "GET", `/api/realm/${realmId}/branches`); expect 200 and branches array.
- Optional: revoke then request again expect 401 or 403.

**Step 2: Run delegates e2e**

Run: `cd apps/server-next && bun test e2e/delegates.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/server-next/e2e/delegates.test.ts
git commit -m "test(server-next): e2e Delegate assign and access"
```

---

## Task 7: Branches e2e (Worker path)

**Files:**
- Create: `apps/server-next/e2e/branches.test.ts`

**Step 1: Write branch/worker tests**

- describe("Branches / Worker"): beforeAll ctx, realmId = "e2e-" + crypto.randomUUID(); ensure realm has root (e.g. one list or mkdir with user token so root exists).
- it("create branch returns branchId and accessToken"): userToken = createUserToken(realmId); createBranch(userToken, realmId, { mountPath: "sub" }); expect branchId and accessToken.
- it("worker token can list own branch"): create branch; authRequest(accessToken, "GET", `/api/realm/me/branches`); expect 200 and single branch.
- it("worker token can list files at root"): authRequest(accessToken, "GET", `/api/realm/me/files`); expect 200 (empty or entries).

**Step 2: Run branches e2e**

Run: `cd apps/server-next && bun test e2e/branches.test.ts`
Expected: PASS (branch creation may require realm root to exist; create one file or mkdir with user first if needed).

**Step 3: Commit**

```bash
git add apps/server-next/e2e/branches.test.ts
git commit -m "test(server-next): e2e Branch create and Worker access"
```

---

## Task 8: MCP e2e

**Files:**
- Create: `apps/server-next/e2e/mcp.test.ts`

**Step 1: Write MCP tests**

- describe("MCP"): beforeAll ctx, realmId = "e2e-" + crypto.randomUUID().
- it("initialize returns protocolVersion and capabilities"): token = createUserToken(realmId); res = await helpers.mcpRequest(token, "initialize"); expect 200; body = await res.json(); expect body.result.protocolVersion, body.result.capabilities.
- it("tools/list returns tools array"): mcpRequest(token, "tools/list"); expect body.result.tools length > 0.
- it("tools/call branches_list returns content"): mcpRequest(token, "tools/call", { name: "branches_list", arguments: {} }); expect 200; body.result.content[0].text parse JSON and expect branches array.
- it("tools/call fs_ls returns entries"): (optional) ensure root exists; mcpRequest(token, "tools/call", { name: "fs_ls", arguments: { path: "" } }); expect result.content with entries.

**Step 2: Run MCP e2e**

Run: `cd apps/server-next && bun test e2e/mcp.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/server-next/e2e/mcp.test.ts
git commit -m "test(server-next): e2e MCP initialize, tools/list, tools/call"
```

---

## Task 9: test:e2e script and full run

**Files:**
- Modify: `apps/server-next/package.json`

**Step 1: Add scripts**

In `apps/server-next/package.json` scripts: add `"test:unit": "bun test tests/"`, `"test:e2e": "bun test e2e/"`, change `"test"` to `"bun run test:unit && bun run test:e2e"` (or keep "test": "bun test" if bun test runs both tests/ and e2e/ by default; then add only "test:e2e": "bun test e2e/" so CI can run e2e alone). Prefer: "test": "bun run test:unit && bun run test:e2e", "test:unit": "bun test tests/", "test:e2e": "bun test e2e/".

**Step 2: Run full test suite**

Run: `cd apps/server-next && bun run test`
Expected: All unit and e2e pass.

**Step 3: Commit**

```bash
git add apps/server-next/package.json
git commit -m "chore(server-next): test:unit and test:e2e scripts"
```

---

## Task 10: Root test script (optional)

**Files:**
- Modify: `package.json` (repo root)

**Step 1: Include server-next e2e in root test:e2e**

If root has a test:e2e that runs other apps, append: `cd apps/server-next && bun run test:e2e` (or equivalent). Only if desired per design doc.

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: run server-next e2e from root test:e2e"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-01-server-next-e2e-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session in the worktree and use executing-plans for batch execution with checkpoints.

Which approach?
