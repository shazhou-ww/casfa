# Agent Cell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Agent Cell (apps/agent) per [2026-03-08-agent-cell-design.md](./2026-03-08-agent-cell-design.md): frontend calls configurable LLM APIs (provider + model); backend syncs only settings and thread/message data via REST; auth reuses SSO + Cookie; merge strategy is settings by key (LWW) and messages by thread (append).

**Architecture:** New cell under apps/agent with cell.yaml (backend Hono + frontend SPA), DynamoDB tables threads/messages/settings. Backend reuses patterns from server-next and image-workshop: getTokenFromRequest + cell-cognito-server resolveAuth, login redirect to SSO, CSRF for writes, realm from JWT. API prefix `/api/realm/:realmId` with realmId validated to match auth. Frontend uses MUI, fetches on load/switch/focus, merges settings by key and messages by thread.

**Tech Stack:** Hono, DynamoDB (AWS SDK), @casfa/cell-auth-server, @casfa/cell-cognito-server, React, MUI, React Router, Zustand (or similar). Reference: apps/server-next (auth, middleware, app structure), apps/image-workshop (simpler app deps), apps/sso (cell.yaml params).

---

## Task 1: Create apps/agent scaffold and cell.yaml

**Files:**
- Create: `apps/agent/package.json`
- Create: `apps/agent/cell.yaml`
- Create: `apps/agent/tsconfig.json`
- Create: `apps/agent/backend/package.json` (optional; or use root workspace)
- Create: `apps/agent/frontend/package.json` (optional)
- Reference: `apps/server-next/cell.yaml`, `apps/image-workshop/cell.yaml`, `apps/sso/cell.yaml`

**Step 1: Add agent to workspace**

Ensure `apps/agent` is included in the repo root `package.json` workspaces if applicable (e.g. `"apps/*"` or explicit `"apps/agent"`).

**Step 2: Create apps/agent/package.json**

Copy structure from `apps/server-next/package.json`. Name: `@casfa/agent`. Scripts: dev, build, deploy, typecheck, test, test:unit, test:e2e, lint via `cell` CLI. Dependencies: backend will need hono, @casfa/cell-auth-server, @casfa/cell-cognito-server, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb; frontend will need react, react-dom, @mui/material, @emotion/react, @emotion/styled, react-router-dom, zustand. DevDep: @casfa/cell-cli, typescript.

**Step 3: Create apps/agent/cell.yaml**

- name: agent
- bucketNameSuffix: (same as other cells, e.g. casfa-shazhou-me)
- backend.dir: backend, runtime: nodejs20.x, entries.api: handler lambda.ts, app dev-app.ts, timeout 30, memory 1024, routes: /api/*, /oauth/login, /oauth/logout, /oauth/register, /oauth/client-info, /oauth/token, /.well-known/*
- frontend.dir: frontend, entries.main: entry index.html, routes: ["/*"]
- tables: threads (pk S, sk S; gsi1pk S, gsi1sk S), messages (pk S, sk S), settings (pk S, sk S)
- params: COGNITO_REGION, COGNITO_USER_POOL_ID, DOMAIN_HOST, DNS (provider, zone), LOG_LEVEL, SSO_BASE_URL
- domain: host !Param DOMAIN_HOST, dns !Param DNS
- testing.unit: backend/

Table definitions for cell-cli (DynamoDB keys):
- threads: keys pk S, sk S; gsi thread-list: gsi1pk S, gsi1sk S, projection ALL
- messages: keys pk S, sk S
- settings: keys pk S, sk S

Also add grants and pending_client_info tables (same shape as server-next) so login redirect and optional OAuth can use them.

**Step 4: Create apps/agent/tsconfig.json**

Extend from root or copy from server-next (include backend + frontend).

**Step 5: Commit**

```bash
git add apps/agent/
git commit -m "chore(agent): add cell scaffold and cell.yaml"
```

---

## Task 2: Backend config, types, and auth wiring

**Files:**
- Create: `apps/agent/backend/config.ts`
- Create: `apps/agent/backend/types.ts`
- Create: `apps/agent/backend/request-url.ts`
- Reference: `apps/server-next/backend/config.ts`, `apps/image-workshop/backend/config.ts`, `apps/server-next/backend/types.ts`

**Step 1: Write backend/config.ts**

ENV_NAMES and ServerConfig type: PORT, CELL_BASE_URL, MOCK_JWT_SECRET, COGNITO_REGION, COGNITO_USER_POOL_ID, DYNAMODB_ENDPOINT, DYNAMODB_TABLE_GRANTS, DYNAMODB_TABLE_PENDING_CLIENT_INFO, DYNAMODB_TABLE_THREADS, DYNAMODB_TABLE_MESSAGES, DYNAMODB_TABLE_SETTINGS, LOG_LEVEL, SSO_BASE_URL, AUTH_COOKIE_*. loadConfig() reads env and returns ServerConfig. isMockAuthEnabled(config) when MOCK_JWT_SECRET and CELL_STAGE=test. Table names default to `agent-${stage}-threads` etc.

**Step 2: Write backend/request-url.ts**

getRequestBaseUrl(c): from Host and X-Forwarded-Proto/X-Forwarded-Host (same as server-next/backend/request-url.ts). Copy or adapt from server-next.

**Step 3: Write backend/types.ts**

Env type with Variables.auth: { type: 'user', userId, email?, name?, picture? }. ErrorBody: { error: string, message: string, details?: unknown }. Thread, Message, Setting types matching design (threadId, title, createdAt, updatedAt, modelId; messageId, threadId, role, content, createdAt; key, value, updatedAt).

**Step 4: Commit**

```bash
git add apps/agent/backend/config.ts apps/agent/backend/types.ts apps/agent/backend/request-url.ts
git commit -m "feat(agent): backend config, types, request-url"
```

---

## Task 3: Backend auth middleware and login redirect

**Files:**
- Create: `apps/agent/backend/middleware/auth.ts`
- Create: `apps/agent/backend/middleware/realm.ts`
- Create: `apps/agent/backend/middleware/csrf.ts` (or reuse from package if exists)
- Create: `apps/agent/backend/controllers/login-redirect.ts`
- Create: `apps/agent/backend/controllers/csrf.ts`
- Reference: `apps/server-next/backend/middleware/auth.ts`, `apps/server-next/backend/middleware/realm.ts`, `apps/server-next/backend/controllers/login-redirect.ts`, `apps/server-next/backend/controllers/csrf.ts`

**Step 1: Auth middleware**

createAuthMiddleware(): if !c.get('auth') return 401 JSON { error: 'UNAUTHORIZED', message: '...' }; else next(). Same as server-next.

**Step 2: Realm middleware**

createRealmMiddleware(): getEffectiveRealmId(auth) => auth.type === 'user' ? auth.userId : auth.realmId. If param('realmId') === 'me', set to getEffectiveRealmId(auth). Require param === effectiveRealmId else 403.

**Step 3: CSRF middleware and controller**

Copy or depend on cell-cognito-server/cell-auth-server for CSRF. createCsrfController: GET /api/csrf returns { csrfToken }; cookie set by backend. createCsrfMiddleware: for POST/PATCH/PUT/DELETE require X-CSRF-Token header equals cookie. Reference server-next/backend/middleware/csrf.ts and controllers/csrf.ts.

**Step 4: Login redirect routes**

createLoginRedirectRoutes(config, { pendingClientInfoStore }). GET /oauth/login: if auth redirect to return_url else redirect to ${ssoBaseUrl}/login?return_url=... GET /oauth/logout: clear auth cookie, redirect to /oauth/login. GET /.well-known/oauth-authorization-server: return JSON issuer, endpoints. POST /oauth/register: stub with pendingClientInfoStore.put('mcp', ...). Use getRequestBaseUrl(c) for base. Copy from server-next and trim to what agent needs.

**Step 5: Commit**

```bash
git add apps/agent/backend/middleware/ apps/agent/backend/controllers/login-redirect.ts apps/agent/backend/controllers/csrf.ts
git commit -m "feat(agent): auth middleware, realm, CSRF, login redirect"
```

---

## Task 4: DynamoDB stores for threads, messages, settings

**Files:**
- Create: `apps/agent/backend/db/thread-store.ts`
- Create: `apps/agent/backend/db/message-store.ts`
- Create: `apps/agent/backend/db/settings-store.ts`
- Reference: `apps/server-next/backend/db/` for DynamoDB pattern, design doc §2

**Step 1: Thread store**

ThreadStore: list(realmId, limit?, cursor?) => { items: Thread[], nextCursor? }; get(realmId, threadId) => Thread | null; create(realmId, input: { title?, modelId? }) => Thread; update(realmId, threadId, partial); delete(realmId, threadId). Keys: pk = REALM#{realmId}, sk = THREAD#{threadId}. GSI: gsi1pk = REALM#{realmId}, gsi1sk = THREAD#{updatedAt}#{threadId} for list ordered by updatedAt desc. Use DynamoDBDocumentClient from @aws-sdk/lib-dynamodb. Generate threadId (e.g. ulid or thr_ + crockford base32).

**Step 2: Message store**

MessageStore: list(threadId, limit?, cursor?) => { items: Message[], nextCursor? }; create(threadId, input: { role, content }) => Message. Keys: pk = THREAD#{threadId}, sk = MSG#{createdAt}#{messageId}. content is Array<{ type: 'text', text: string }>. Generate messageId. Before create, verify thread exists and belongs to realm (need threadStore.get or pass realmId and check).

**Step 3: Settings store**

SettingsStore: list(realmId) => { items: { key, value, updatedAt }[] }; get(realmId, key) => { value, updatedAt } | null; set(realmId, key, value) => { key, value, updatedAt }. Keys: pk = REALM#{realmId}, sk = SETTING#{key}. value stored as JSON. updatedAt = Date.now() on set.

**Step 4: Commit**

```bash
git add apps/agent/backend/db/
git commit -m "feat(agent): DynamoDB stores for threads, messages, settings"
```

---

## Task 5: Backend API routes (threads, messages, settings)

**Files:**
- Create: `apps/agent/backend/controllers/threads.ts`
- Create: `apps/agent/backend/controllers/messages.ts`
- Create: `apps/agent/backend/controllers/settings.ts`
- Create: `apps/agent/backend/app.ts`
- Create: `apps/agent/backend/dev-app.ts`
- Create: `apps/agent/backend/lambda.ts`
- Create: `apps/agent/backend/index.ts`
- Reference: design §3, server-next/backend/app.ts, server-next/backend/dev-app.ts

**Step 1: Threads controller**

createThreadsController({ threadStore }). GET /api/realm/:realmId/threads: list(realmId, limit, cursor), return { threads, nextCursor }. POST: create(realmId, body). GET /api/realm/:realmId/threads/:threadId: get; 404 if not found. PATCH: update; 404 if not found. DELETE: delete thread and all its messages (call messageStore.deleteByThread(threadId) or list+delete).

**Step 2: Messages controller**

createMessagesController({ messageStore, threadStore }). GET /api/realm/:realmId/threads/:threadId/messages: verify thread belongs to realmId (threadStore.get), then messageStore.list(threadId). POST: verify thread, then create(threadId, body). Validate body.role in ['user','assistant','system'] and content array of { type: 'text', text: string }.

**Step 3: Settings controller**

createSettingsController({ settingsStore }). GET /api/realm/:realmId/settings: list(realmId), return { items } or keyed object. GET /api/realm/:realmId/settings/:key: get(realmId, key); 404 or { value: null } if missing. PUT /api/realm/:realmId/settings/:key: set(realmId, key, body.value), return { key, value, updatedAt }.

**Step 4: app.ts**

Hono app: cors, auth (getTokenFromRequest + oauthServer.resolveAuth), login redirect routes, CSRF routes, apply CSRF middleware for /api/*. authMiddleware + realmMiddleware for /api/realm/:realmId/*. Mount threads, messages, settings routes under /api/realm/:realmId (use :realmId so "me" can be resolved by realm middleware). GET /api/health, GET /api/info. onError 500, notFound 404.

**Step 5: dev-app.ts and lambda.ts**

Load config, create DynamoDB client and docClient, create grant store and pending client info store (for login redirect), create Cognito JWT verifier and createOAuthServer, create thread/message/settings stores (DynamoDB), createApp(deps), export app. lambda.ts: same app, export handler for Lambda (see server-next/lambda.ts).

**Step 6: index.ts**

Export app from dev-app or bootstrap for cell dev.

**Step 7: Commit**

```bash
git add apps/agent/backend/controllers/ apps/agent/backend/app.ts apps/agent/backend/dev-app.ts apps/agent/backend/lambda.ts apps/agent/backend/index.ts
git commit -m "feat(agent): API routes and app bootstrap"
```

---

## Task 6: Backend unit tests

**Files:**
- Create: `apps/agent/backend/__tests__/middleware/auth.test.ts`
- Create: `apps/agent/backend/__tests__/db/thread-store.test.ts`
- Create: `apps/agent/backend/__tests__/db/settings-store.test.ts`
- Modify: `apps/agent/package.json` to add test script if not using cell test

**Step 1: Auth middleware test**

Request without auth -> 401. Request with valid auth in context -> next called. Use Hono test pattern (app.request).

**Step 2: Thread store test**

Use in-memory or DynamoDB Local. create realmId + thread, get returns it; list returns it; update title; delete then get null.

**Step 3: Settings store test**

set key then get returns value and updatedAt; list returns items; set same key again, get has newer updatedAt.

**Step 4: Run tests**

Run: `bun run test` or `cell test:unit` from apps/agent. Expected: all pass.

**Step 5: Commit**

```bash
git add apps/agent/backend/__tests__/
git commit -m "test(agent): backend unit tests for auth and stores"
```

---

## Task 7: Frontend shell (MUI, router, auth guard, api client)

**Files:**
- Create: `apps/agent/frontend/index.html`
- Create: `apps/agent/frontend/main.tsx`
- Create: `apps/agent/frontend/App.tsx`
- Create: `apps/agent/frontend/lib/auth.ts`
- Create: `apps/agent/frontend/lib/api.ts`
- Create: `apps/agent/frontend/components/auth-guard.tsx`
- Create: `apps/agent/frontend/components/layout.tsx`
- Create: `apps/agent/frontend/pages/login-page.tsx`
- Create: `apps/agent/frontend/pages/oauth-callback-page.tsx`
- Reference: apps/server-next/frontend (MUI layout, auth guard, login redirect), design §4

**Step 1: index.html and main.tsx**

Entry: index.html with root div, main.tsx renders App with Router (BrowserRouter), ThemeProvider (MUI), CssBaseline. App.tsx: routes for /, /oauth/callback, /login (or redirect to /oauth/login), and protected route for /chat (or /).

**Step 2: auth.ts**

getCsrfToken(): read from cookie or GET /api/csrf and cache. getAuth(): GET /api/me or parse from cookie; return user or null. loginUrl(returnUrl): `${ssoBaseUrl}/login?return_url=...` from /api/info or env. baseUrl: '' or window.location.origin.

**Step 3: api.ts**

fetch wrapper: baseUrl + path, credentials: 'include', headers Content-Type and X-CSRF-Token for write. getThreads(realmId), getThread(realmId, threadId), createThread(realmId, body), patchThread(realmId, threadId, body), deleteThread(realmId, threadId). getMessages(realmId, threadId), createMessage(realmId, threadId, body). getSettings(realmId), getSetting(realmId, key), setSetting(realmId, key, value). RealmId can be 'me' when backend supports it.

**Step 4: auth-guard.tsx**

If !user redirect to loginUrl(current href). Else render children. Use getAuth() and loginUrl from auth.ts.

**Step 5: layout.tsx**

MUI Layout: AppBar with title "Agent", user menu (logout -> /oauth/logout). Drawer or list for thread list (placeholder). Main content area for children. Reference server-next frontend/components/layout.tsx.

**Step 6: login and oauth-callback pages**

Login page: redirect to loginUrl(return_url). OAuth callback: after SSO redirects back, page just renders "Redirecting..." and useEffect redirect to / or return_url. No token exchange on agent (cookie set by SSO).

**Step 7: Commit**

```bash
git add apps/agent/frontend/
git commit -m "feat(agent): frontend shell with MUI, auth guard, api client"
```

---

## Task 8: Frontend settings and thread/message merge + LLM config UI

**Files:**
- Create: `apps/agent/frontend/stores/agent-store.ts` (or split: settings-store, threads-store)
- Create: `apps/agent/frontend/pages/settings-page.tsx`
- Create: `apps/agent/frontend/components/settings/llm-providers-editor.tsx`
- Reference: design §4.2, §4.3, §4.4

**Step 1: Agent store (Zustand)**

State: settings: Record<string, { value: unknown, updatedAt: number }>, threads: Thread[], currentThreadId: string | null, messagesByThread: Record<string, Message[]>. Actions: fetchSettings(realmId), mergeSettings(serverItems) — per key, if server.updatedAt > local use server. fetchThreads(realmId), mergeThreads(serverThreads). fetchMessages(realmId, threadId), mergeMessages(threadId, serverMessages) — append by createdAt order, dedupe by messageId. setSetting(realmId, key, value) calls api then update local.

**Step 2: Settings page**

List settings keys (e.g. llm.providers, ui.theme). For llm.providers show list of providers (name, baseUrl, models count); Edit button opens LLM providers editor. MUI: List, ListItem, Button, Dialog.

**Step 3: LLM providers editor**

Form: list of provider cards. Each: id, name, baseUrl, apiKey (password input), models: list of { id, name }. Add provider / Add model buttons. Save calls setSetting(realmId, 'llm.providers', value). Value shape: Array<{ id, name?, baseUrl, apiKey, models: Array<{ id, name? }> }>. Don’t display apiKey in plain text; mask or leave empty when loading.

**Step 4: Pull on load and focus**

In layout or App: on mount and when window 'focus', call fetchSettings('me') and fetchThreads('me'). When currentThreadId changes, fetchMessages('me', currentThreadId). Merge using store actions above.

**Step 5: Commit**

```bash
git add apps/agent/frontend/stores/ apps/agent/frontend/pages/settings-page.tsx apps/agent/frontend/components/
git commit -m "feat(agent): settings and thread/message merge, LLM config UI"
```

---

## Task 9: Frontend chat UI and direct LLM call

**Files:**
- Create: `apps/agent/frontend/pages/chat-page.tsx`
- Create: `apps/agent/frontend/components/chat/thread-list.tsx`
- Create: `apps/agent/frontend/components/chat/message-list.tsx`
- Create: `apps/agent/frontend/components/chat/compose.tsx`
- Create: `apps/agent/frontend/lib/llm-client.ts`
- Reference: design §4.5, §4.6

**Step 1: llm-client.ts**

callChatCompletion(provider: { baseUrl, apiKey, models }, modelId, messages: { role, content }[]): POST `${provider.baseUrl}/v1/chat/completions` (or provider-supplied path), headers Authorization: Bearer apiKey, body { model: modelId, messages }. Return full response or stream. Handle 401/403/5xx and throw with message. Optional: streamChatCompletion for SSE.

**Step 2: thread-list.tsx**

List threads from store (sorted by updatedAt). New thread button -> createThread('me', {}), set currentThreadId. Select thread -> set currentThreadId. MUI List, ListItemButton.

**Step 3: message-list.tsx**

Render messages for currentThreadId from store (messagesByThread[threadId]). Each message: role (user/assistant/system), content (map content parts: type 'text' -> text). MUI List, Paper, Typography.

**Step 4: compose.tsx**

Input + Send button. On send: 1) Optimistic: append user message to local state. 2) POST createMessage('me', threadId, { role: 'user', content: [{ type: 'text', text }] }). 3) Build messages array for LLM (history + new user message). 4) Get provider+model from thread or settings (default). 5) callChatCompletion(provider, modelId, messages). 6) On success append assistant message to local state and POST createMessage('me', threadId, { role: 'assistant', content: [{ type: 'text', text: assistantText }] }). On error show snackbar. Disable send while loading.

**Step 5: chat-page.tsx**

Layout: sidebar thread list, main area message list + compose. Use store’s currentThreadId and messagesByThread. If no thread selected show "Select or create a thread".

**Step 6: Route and nav**

Add route /chat (or /) for chat page. Layout nav link to /chat and /settings. Auth guard wraps these.

**Step 7: Commit**

```bash
git add apps/agent/frontend/pages/chat-page.tsx apps/agent/frontend/components/chat/ apps/agent/frontend/lib/llm-client.ts
git commit -m "feat(agent): chat UI and direct LLM call"
```

---

## Task 10: Integration and manual verification

**Files:**
- Modify: `apps/agent/cell.symbiont.yaml` (if needed for local domain)
- Reference: .github/copilot-instructions.md for test commands

**Step 1: cell dev**

From repo root or apps/agent run `cell dev` (or `bun run dev`). Ensure backend starts (Hono on port), frontend builds and serves. Ensure SSO_BASE_URL and COGNITO_* are set (e.g. .env.local from .env.example). If no SSO locally use MOCK_JWT_SECRET and CELL_STAGE=test for dev.

**Step 2: Manual flow**

Open frontend; redirect to SSO login (or mock). After login, open /chat; create thread; open settings and add one LLM provider (baseUrl + apiKey + one model). Back to chat, send message; verify request goes to provider baseUrl and response appears. Check network: POST to /api/realm/me/threads, /api/realm/me/threads/:id/messages, and to provider baseUrl.

**Step 3: Document .env.example**

Create apps/agent/.env.example and .env.local.example with COGNITO_REGION, COGNITO_USER_POOL_ID, SSO_BASE_URL, DOMAIN_HOST, DNS, LOG_LEVEL, DYNAMODB_* table names (optional for local), MOCK_JWT_SECRET for test.

**Step 4: Commit**

```bash
git add apps/agent/.env.example apps/agent/.env.local.example
git commit -m "chore(agent): env examples and integration verification"
```

---

## Execution options

Plan complete and saved to `docs/plans/2026-03-08-agent-cell-impl.md`.

**Two execution options:**

1. **Subagent-driven (this session)** — I run one subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — You open a new session with executing-plans in the same worktree and run through the plan with checkpoints.

Which approach do you prefer?
