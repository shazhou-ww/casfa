# SSO Cell + 纯 Cookie 鉴权 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现单一 SSO cell 负责 OAuth 与 Cookie 发放，业务 cell（server-next、image-workshop）仅校验 Cookie + 本域 CSRF；refresh 专用 POST /oauth/refresh，refresh token 仅通过 HttpOnly cookie 限定 Path=/oauth/refresh；Cookie 安全要求 SameSite=Strict、Secure（localhost 可放宽）、各子域自管 CSRF。

**Architecture:** 新建 apps/sso cell 承载 authorize/callback/token/refresh/logout；cell-oauth 增加 SameSite=Strict、refresh cookie 构建、CSRF 工具；**cell-auth-webui**（前端 cookie-only）与 **cell-auth-client**（CLI Bearer）已拆分为两个包；业务 cell 前端 SSO 模式用 cell-auth-webui，非 SSO 用 cell-auth-client；业务 cell 后端鉴权从 cookie 读 token、本域签发并校验 CSRF。

**Tech Stack:** Hono、@casfa/cell-oauth、@casfa/cell-cognito、@casfa/cell-auth-webui、@casfa/cell-auth-client；设计稿见 `docs/plans/2026-03-06-sso-cell-cookie-auth-design.md`。

---

## Phase 1: cell-oauth Cookie 与 CSRF 能力

### Task 1: cell-oauth — SameSite=Strict 与 Secure 逻辑

**Files:**
- Modify: `packages/cell-oauth/src/cookie.ts`
- Test: `packages/cell-oauth/src/cookie.test.ts`

**Step 1: 扩展 BuildAuthCookieOptions，增加 sameSite，secure 根据 options 或 isSecureContext**

在 `BuildAuthCookieOptions` 中增加可选 `sameSite?: "Strict" | "Lax"`（默认 `"Strict"`）。`buildAuthCookieHeader` 使用 `sameSite` 拼进 Set-Cookie；保留 `secure?: boolean`（true 时加 Secure）。

**Step 2: 为 buildClearAuthCookieHeader 增加 sameSite**

`BuildClearAuthCookieOptions` 增加可选 `sameSite?: "Strict" | "Lax"`，清除时与设置时一致（默认 Strict）。

**Step 3: 为 cookie.test.ts 增加 SameSite=Strict 与 Secure 的用例**

- 默认调用应包含 `SameSite=Strict`。
- `secure: true` 时包含 `Secure`。
- `buildClearAuthCookieHeader` 默认包含 `SameSite=Strict`。

**Step 4: 运行测试**

Run: `cd packages/cell-oauth && bun test src/cookie.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cell-oauth/src/cookie.ts packages/cell-oauth/src/cookie.test.ts
git commit -m "feat(cell-oauth): add SameSite=Strict and optional Secure to cookie helpers"
```

---

### Task 2: cell-oauth — buildRefreshCookieHeader（Path=/oauth/refresh）

**Files:**
- Modify: `packages/cell-oauth/src/cookie.ts`
- Modify: `packages/cell-oauth/src/index.ts`
- Test: `packages/cell-oauth/src/cookie.test.ts`

**Step 1: 新增 BuildRefreshCookieOptions 与 buildRefreshCookieHeader**

- 类型与 `BuildAuthCookieOptions` 类似，但 Path 建议固定为 `/oauth/refresh`（或可配置）。
- 生成 Set-Cookie 值：HttpOnly、SameSite=Strict、Secure（可选）、Domain/Path/Max-Age。

**Step 2: 新增 buildClearRefreshCookieHeader**

与 buildClearAuthCookieHeader 类似，用于清除 refresh cookie（Path 与 Domain 一致）。

**Step 3: 在 index.ts 中导出 buildRefreshCookieHeader、buildClearRefreshCookieHeader**

**Step 4: cookie.test.ts 中增加 buildRefreshCookieHeader / buildClearRefreshCookieHeader 单测**

- Path 为 `/oauth/refresh`；含 HttpOnly、SameSite=Strict。

**Step 5: 运行测试并提交**

Run: `cd packages/cell-oauth && bun test src/cookie.test.ts`
Expected: PASS

```bash
git add packages/cell-oauth/src/cookie.ts packages/cell-oauth/src/index.ts packages/cell-oauth/src/cookie.test.ts
git commit -m "feat(cell-oauth): add refresh cookie helpers with Path=/oauth/refresh"
```

---

### Task 3: cell-oauth — CSRF 工具（各子域自用）

**Files:**
- Create: `packages/cell-oauth/src/csrf.ts`
- Modify: `packages/cell-oauth/src/index.ts`
- Test: `packages/cell-oauth/src/csrf.test.ts`

**Step 1: 写 csrf.test.ts（先失败）**

- `generateCsrfToken()` 返回 32 字节 hex 字符串。
- `getCsrfFromRequest(request, { cookieName: "csrf_token" })`：从 Cookie 头解析指定 name 的值，无则 null。
- `validateCsrf(request, { cookieName: "csrf_token", headerName: "X-CSRF-Token" })`：cookie 与 header 值非空且相等返回 true，否则 false。
- `buildCsrfCookieHeader(value, { cookieName, secure?, sameSite? })`：生成 Set-Cookie 值，不含 HttpOnly，SameSite 默认 Strict，Secure 可选。

**Step 2: 运行测试确认失败**

Run: `cd packages/cell-oauth && bun test src/csrf.test.ts`
Expected: FAIL (module/csrf not found or functions missing)

**Step 3: 实现 csrf.ts**

- `generateCsrfToken()`: `crypto.getRandomValues` 生成 32 字节，转 hex。
- `getCsrfFromRequest`: 解析 Cookie 头，与 cookie.ts 逻辑类似，按 cookieName 取值。
- `validateCsrf`: 读 cookie 与 header，严格比较（非空且相等）。
- `buildCsrfCookieHeader`: 不设 HttpOnly；SameSite=Strict；Secure 按 options；Path=/。

**Step 4: 运行测试通过并导出**

Run: `cd packages/cell-oauth && bun test src/csrf.test.ts`
Expected: PASS

在 `index.ts` 中导出 csrf 中所有对外函数与类型。

**Step 5: Commit**

```bash
git add packages/cell-oauth/src/csrf.ts packages/cell-oauth/src/csrf.test.ts packages/cell-oauth/src/index.ts
git commit -m "feat(cell-oauth): add CSRF helpers for per-subdomain double submit"
```

---

## Phase 2: SSO cell（apps/sso）

**说明：** 执行顺序为 Task 4 → Task 6 → Task 5（Task 6 的 getCookieFromRequest 供 Task 5 的 /oauth/refresh 使用）。

### Task 4: 创建 apps/sso 脚手架

**Files:**
- Create: `apps/sso/package.json`
- Create: `apps/sso/tsconfig.json`
- Create: `apps/sso/cell.yaml`
- Create: `apps/sso/backend/app.ts`
- Create: `apps/sso/backend/index.ts`
- Create: `apps/sso/backend/config.ts`
- Create: `apps/sso/backend/lambda.ts`（若与 server-next 类似）
- Create: `apps/sso/.env.example`

**Step 1: package.json**

参考 server-next：依赖 @casfa/cell-oauth、@casfa/cell-cognito、hono、jose 等；scripts 使用 cell-cli（dev/build/test）。

**Step 2: cell.yaml**

- backend 仅 api 入口；routes 包含 /oauth/authorize、/oauth/callback、/oauth/token、/oauth/refresh、/oauth/logout、/.well-known/*、/oauth/register。
- params 包含 COGNITO_*、AUTH_COOKIE_NAME、AUTH_REFRESH_COOKIE_NAME、AUTH_COOKIE_DOMAIN、AUTH_COOKIE_MAX_AGE_SECONDS、AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS 等。

**Step 3: config.ts**

从 process.env 读取上述 cookie 与 Cognito 配置；提供 isLocalhost() 或类似，用于 Secure 是否放宽（仅当 host 为 localhost 时不加 Secure）。

**Step 4: app.ts 最小骨架**

- 创建 Hono app；CORS；挂载 OAuth 相关路由（下一 Task 实现）；健康检查 GET /api/health 或 / 返回 200。

**Step 5: index.ts / lambda.ts**

- 导出 app 或适配 cell-cli 的 lambda handler（参考 server-next）。

**Step 6: .env.example**

- 列出 AUTH_COOKIE_NAME、AUTH_REFRESH_COOKIE_NAME、AUTH_COOKIE_DOMAIN、COGNITO_* 等，无真实密钥。

**Step 7: Commit**

```bash
git add apps/sso/
git commit -m "chore(sso): add SSO cell scaffold and config"
```

---

### Task 6: cell-oauth — 支持从指定 Cookie 名读 refresh token

**Files:**
- Modify: `packages/cell-oauth/src/cookie.ts`
- Modify: `packages/cell-oauth/src/index.ts`
- Test: `packages/cell-oauth/src/cookie.test.ts`

**Step 1: 新增 getCookieFromRequest(request, cookieName: string): string | null**

- 仅从 Cookie 头解析指定 name 的值（与 getTokenFromRequest 中 cookie 解析逻辑一致，但不读 Authorization）。用于 refresh 场景只读 refresh cookie。

**Step 2: 导出 getCookieFromRequest**

- 在 index.ts 导出，供 SSO 的 /oauth/refresh 使用。

**Step 3: cookie.test.ts 增加 getCookieFromRequest 用例**

- 有 Cookie 时返回对应值；无或 name 不匹配返回 null。

**Step 4: 运行测试并提交**

Run: `cd packages/cell-oauth && bun test src/cookie.test.ts`
Expected: PASS

```bash
git add packages/cell-oauth/src/cookie.ts packages/cell-oauth/src/index.ts packages/cell-oauth/src/cookie.test.ts
git commit -m "feat(cell-oauth): add getCookieFromRequest for refresh cookie reading"
```

---

### Task 5: SSO cell — OAuth 路由与 Cookie 写入

**Files:**
- Create: `apps/sso/backend/controllers/oauth.ts`
- Modify: `apps/sso/backend/app.ts`

**Step 1: 实现 authorize**

- GET /oauth/authorize：从 query 取 redirect_uri（或 return_url）、state、client_id 等；生成 state 包含 return_url（业务 cell 登录后回跳 URL）；调用 oauthServer.handleAuthorize，redirect 到 Cognito。redirect_uri 固定为 SSO 自身 callback URL（从 config 读 SSO base URL）。

**Step 2: 实现 callback**

- GET /oauth/callback：从 query 取 code、state；调用 oauthServer.handleCallback(code, state)；成功后用 buildAuthCookieHeader、buildRefreshCookieHeader 写 Cookie（SameSite=Strict，Secure 除 localhost）；重定向到 state 中的 return_url。

**Step 3: 实现 POST /oauth/token（仅 code）**

- 请求体仅解析 code、code_verifier（无 grant_type）。调用 oauthServer.handleToken({ grantType: "authorization_code", code, codeVerifier, refreshToken: null, clientId: null })。成功则 Set-Cookie：access + refresh（Path=/oauth/refresh），SameSite=Strict，Secure 除 localhost。返回 JSON access_token/refresh_token 等（可与现有一致）。

**Step 4: 实现 POST /oauth/refresh**

- 从 Cookie 读取 refresh token：使用 `getCookieFromRequest(c.req.raw, refreshCookieName)`（Task 6 已实现）。调用 Cognito refresh（或 oauthServer 若暴露 refresh 接口）；轮转后写新 access + refresh cookie；返回 200 或 JSON。

**Step 5: 实现 POST /oauth/logout**

- 使用 buildClearAuthCookieHeader、buildClearRefreshCookieHeader，Path/Domain 与设置时一致，Max-Age=0；Set-Cookie 两个清除头；返回 200。

**Step 6: 实现 /.well-known/oauth-authorization-server 与 POST /oauth/register**

- 委托 oauthServer.getMetadata() 与 registerClient；register 按现有 body 解析。

**Step 7: app.ts 挂载上述路由并注入 config、oauthServer**

- oauthServer 需 Cognito + jwtVerifier + grantStore（SSO 若只做用户登录，可简化 grantStore 或复用内存/ DynamoDB）。

**Step 8: Cookie 安全**

- 所有 Set-Cookie 使用 SameSite=Strict；Secure 仅在非 localhost 时加（从 request host 或 config 判断）。

**Step 9: Commit**

```bash
git add apps/sso/backend/
git commit -m "feat(sso): implement OAuth routes and cookie-based auth/refresh"
```

---

## Phase 3: cell-auth-webui 与 cell-auth-client 拆分（已完成）

- **cell-auth-webui**（`@casfa/cell-auth-webui`）：前端专用，仅 cookie。createAuthClient(ssoBaseUrl, logoutEndpoint)、createApiFetch(credentials, X-CSRF-Token, 401→refresh)。getAuth() 恒为 null，用户信息由 /api/me 提供。
- **cell-auth-client**（`@casfa/cell-auth-client`）：CLI/非浏览器专用，仅 Bearer。createAuthClient(storagePrefix)、createApiFetch(Authorization: Bearer)。无 cookie、无 CSRF、无 refresh。
- server-next：SSO 模式用 cell-auth-webui，非 SSO 用 cell-auth-client。

---

## Phase 3b: cell-auth-client 原「纯 Cookie 模式」任务（已由 cell-auth-webui 替代）

### Task 7: ~~cell-auth-client — 支持 cookieOnly 与 ssoBaseUrl~~ → 见 cell-auth-webui

**Files:**
- Modify: `packages/cell-auth-client/src/auth-client.ts`
- Modify: `packages/cell-auth-client/src/types.ts`
- Modify: `packages/cell-auth-client/src/api-fetch.ts`

**Step 1: 扩展 createAuthClient 参数**

- `cookieOnly?: boolean`：为 true 时不读写 localStorage 的 token/refresh。
- `ssoBaseUrl?: string`：SSO 根 URL，用于 logout 与 refresh（如 `https://auth.example.com`）。
- `logoutEndpoint?: string`：保留，可为 `/oauth/logout`；当 cookieOnly 且 ssoBaseUrl 存在时，logout 请求为 `ssoBaseUrl + logoutEndpoint`。

**Step 2: cookieOnly 时 getAuth()**

- 不读 localStorage；可返回 null，或依赖后续 /api/me 结果缓存（下一 Task 可做）。本 Task 先实现为 cookieOnly 时 getAuth() 恒为 null，由调用方通过 /api/me 获取用户信息。

**Step 3: cookieOnly 时 setTokens**

- 无操作（不写 localStorage）。若前端仍会在 callback 后调 setTokens，可保留空实现。

**Step 4: cookieOnly 时 logout()**

- 若有 ssoBaseUrl + logoutEndpoint，则 fetch(ssoBaseUrl + logoutEndpoint, { method: "POST", credentials: "include" })；然后清除本地可能存在的缓存（如有）；notify()；不读 localStorage。

**Step 5: createApiFetch 在 cookieOnly 时**

- 不设置 Authorization header。
- 始终 credentials: "include"。
- 下一 Task 增加 X-CSRF-Token（本 Task 仅保证不发 Bearer）。

**Step 6: 单测或类型检查**

Run: `cd packages/cell-auth-client && bun run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/cell-auth-client/src/
git commit -m "feat(cell-auth-client): add cookieOnly and ssoBaseUrl for SSO logout"
```

---

### Task 8: ~~cell-auth-client — 带 X-CSRF-Token 与 401 时尝试 refresh~~ → 已由 cell-auth-webui 实现

**Files:**
- Modify: `packages/cell-auth-client/src/api-fetch.ts`
- Modify: `packages/cell-auth-client/src/types.ts`（若需 csrfCookieName）

**Step 1: createApiFetch 增加可选 csrfCookieName、ssoRefreshPath**

- 当 csrfCookieName 有值时：从 document.cookie 解析该 cookie 值（仅浏览器环境；Node 可忽略或传空），在请求头中设置 X-CSRF-Token。
- 当 ssoBaseUrl 与 ssoRefreshPath（如 `/oauth/refresh`）有值时：若响应 401，先 POST ssoBaseUrl + ssoRefreshPath（credentials: "include"，不带 body），若 200 则重试原请求一次；若仍 401 或 refresh 失败则 onUnauthorized()。

**Step 2: 读取 document.cookie 的辅助函数**

- 在 api-fetch 或单独 util 中实现 getCookieValue(name: string): string | null（解析 document.cookie），仅在前端环境使用。

**Step 3: 单测**

- 可对 getCookieValue 做单测；或依赖集成测试。类型检查通过即可。

**Step 4: Commit**

```bash
git add packages/cell-auth-client/src/
git commit -m "feat(cell-auth-client): add X-CSRF-Token and 401 refresh retry for cookie-only mode"
```

---

## Phase 4: 业务 cell — server-next

### Task 9: server-next — 移除本机 OAuth 实现，改为重定向到 SSO

**Files:**
- Modify: `apps/server-next/backend/app.ts`
- Modify: `apps/server-next/backend/controllers/oauth.ts` 或删除并新建重定向控制器
- Modify: `apps/server-next/backend/config.ts`
- Modify: `apps/server-next/cell.yaml`（路由可保留 /oauth/login 或 /api/login-redirect）
- Modify: `apps/server-next/frontend/src/lib/auth.ts`
- Modify: `apps/server-next/frontend` 中登录入口（如登录页、oauth-callback 页）

**Step 1: config 增加 ssoBaseUrl**

- 从 env 读 SSO_BASE_URL（如 `https://auth.casfa.example.com`），用于后端重定向与前端 logout/refresh。

**Step 2: 后端「登录」入口**

- 新增 GET /oauth/login 或 /api/login-redirect：从 query 取 return_url（可选，默认当前 cell 首页）；重定向到 `${ssoBaseUrl}/oauth/authorize?state=${encodeURIComponent(JSON.stringify({ return_url: return_url || config.cellBaseUrl }))}` 等（与 SSO 约定 state 格式）。SSO 的 authorize 需接受并回传该 state，callback 后重定向到 state.return_url。

**Step 3: 移除或精简 createOAuthRoutes**

- 移除 /oauth/authorize、/oauth/token、/oauth/callback、/oauth/consent-info、/oauth/approve、/oauth/deny；保留 /oauth/logout 仅作重定向到 SSO 的 /oauth/logout（或前端直接调 SSO，后端可不保留）。若保留 /oauth/logout，可改为重定向到 SSO logout 或返回 204 并提示前端调 SSO。

**Step 4: 鉴权中间件**

- 保持从 Cookie 读 token（getTokenFromRequest(c.req.raw, { cookieName })）；不再从 Authorization 优先（设计为纯 cookie）。若 cell-oauth 的 getTokenFromRequest 当前是 Bearer 优先，可改为仅 cookie，或增加选项 cookieOnly: true 只读 cookie。

**Step 5: 前端 auth.ts**

- createAuthClient({ cookieOnly: true, ssoBaseUrl: config.ssoBaseUrl, logoutEndpoint: "/oauth/logout" })；createApiFetch 传入 csrfCookieName（与后端一致，如 "csrf_token"）、ssoBaseUrl、ssoRefreshPath: "/oauth/refresh"。前端 config 需从 build-time 或 runtime 获取 ssoBaseUrl。

**Step 6: 前端登录流程**

- 登录按钮或未登录时跳转到当前 cell 的 /oauth/login（或 /api/login-redirect），由后端重定向到 SSO；OAuth callback 仅在 SSO 完成，用户回到当前 cell 时已带 Cookie，无需再保留 oauth-callback 页的 code 交换逻辑（可删除或改为「登录成功，正在跳转」静态页）。

**Step 7: Commit**

```bash
git add apps/server-next/backend/ apps/server-next/frontend/ apps/server-next/cell.yaml
git commit -m "refactor(server-next): switch to SSO redirect and cookie-only auth"
```

---

### Task 10: server-next — 本域 CSRF 签发与校验

**Files:**
- Create: `apps/server-next/backend/controllers/csrf.ts`（或 middleware）
- Modify: `apps/server-next/backend/middleware/auth.ts` 或 app.ts
- Modify: `apps/server-next/backend/app.ts`

**Step 1: 提供 GET /api/csrf 或首次请求时下发 csrf cookie**

- 使用 cell-oauth 的 generateCsrfToken、buildCsrfCookieHeader；Set-Cookie：csrf_token=xxx；SameSite=Strict；Secure 除 localhost。Path=/。返回 200 或 { token }（可选）。

**Step 2: 写操作中间件**

- 对 POST/PUT/PATCH/DELETE（及需要保护的路径）校验 X-CSRF-Token 与 cookie 中 csrf_token 一致（使用 cell-oauth validateCsrf）；不一致或缺失返回 403。

**Step 3: 前端**

- 在调用 apiFetch 前确保已请求 GET /api/csrf（或页面加载时请求一次），以便 cookie 存在；apiFetch 已带 X-CSRF-Token（Task 8）。

**Step 4: 单测**

- 请求 /api/csrf 返回 Set-Cookie；写请求无 header 返回 403；带正确 X-CSRF-Token 返回 200。

**Step 5: Commit**

```bash
git add apps/server-next/backend/
git commit -m "feat(server-next): add per-subdomain CSRF issuance and validation"
```

---

## Phase 5: 业务 cell — image-workshop

### Task 11: image-workshop — 与 server-next 同模式改造

**Files:**
- Modify: `apps/image-workshop/backend/app.ts`
- Modify: `apps/image-workshop/backend/controllers/oauth.ts`（改为重定向或移除）
- Modify: `apps/image-workshop/frontend/main.tsx`（authClient、apiFetch、登录流程）
- 新增或修改 config、csrf 控制器/中间件

**Step 1: 后端**

- 与 Task 9/10 类似：增加 ssoBaseUrl 配置；登录入口重定向到 SSO /oauth/authorize；移除本机 /oauth/token、/oauth/callback 等；鉴权仅从 Cookie 读 token；增加 GET /api/csrf 与写操作 CSRF 校验。

**Step 2: 前端**

- createAuthClient({ cookieOnly: true, ssoBaseUrl, logoutEndpoint: "/oauth/logout" })；createApiFetch 带 csrfCookieName、ssoBaseUrl、ssoRefreshPath；登录流程改为跳转当前 cell 的登录重定向 URL。

**Step 3: Commit**

```bash
git add apps/image-workshop/
git commit -m "refactor(image-workshop): switch to SSO redirect and cookie-only auth with CSRF"
```

---

## Phase 6: cell-oauth getTokenFromRequest 仅 Cookie 模式

### Task 12: 鉴权仅从 Cookie 读 token（可选）

**Files:**
- Modify: `packages/cell-oauth/src/cookie.ts`
- Modify: `packages/cell-oauth/src/cookie.test.ts`

**Step 1: getTokenFromRequest 增加选项 cookieOnly?: boolean**

- 当 cookieOnly 为 true 时，不读 Authorization，仅从 Cookie 读。业务 cell 鉴权传 cookieOnly: true，与设计「纯 cookie」一致。

**Step 2: 单测**

- cookieOnly: true 时，仅 Cookie 无 Authorization 能取到值；有 Authorization 也不读。

**Step 3: Commit**

```bash
git add packages/cell-oauth/src/cookie.ts packages/cell-oauth/src/cookie.test.ts
git commit -m "feat(cell-oauth): getTokenFromRequest supports cookieOnly mode"
```

---

## Phase 7: 文档与 E2E（可选）

### Task 13: 更新设计稿与 README

**Files:**
- Modify: `docs/plans/2026-03-06-sso-cell-cookie-auth-design.md`（若有实现与设计差异的备注）
- Modify: `apps/sso/README.md`（新建则写部署与配置说明）
- Modify: `apps/server-next/README.md` 或根文档（注明 SSO_BASE_URL 与 cookie-only auth）

**Step 1: 在设计稿变更记录中注明「实现完成，见 2026-03-06-sso-cell-cookie-auth-impl.md」**

**Step 2: apps/sso/README.md**

- 说明如何配置 env、Cookie 域名、localhost Secure 放宽；如何与业务 cell 配合。

**Step 3: Commit**

```bash
git add docs/plans/ apps/sso/README.md
git commit -m "docs: SSO cell and cookie auth implementation notes"
```

---

### Task 14: E2E 或手工验收（可选）

- 本地或测试环境：从 server-next 点登录 → 跳 SSO → 登录后回 server-next，带 cookie；请求 /api/me 成功；写操作带 X-CSRF-Token 成功；登出后请求 401。
- 若已有 E2E 框架，可加一条「SSO login → cookie auth → logout」用例。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-06-sso-cell-cookie-auth-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with @superpowers:executing-plans and run in a worktree for batch execution with checkpoints.

Which approach do you prefer?
