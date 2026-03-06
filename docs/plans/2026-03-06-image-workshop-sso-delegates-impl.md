# image-workshop SSO + cell-delegates 改造 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 参考 server-next 对 image-workshop 做一轮改造：复用 SSO 登录、复用 cell-delegates-*（含 delegate OAuth）、按 docs/cell-config-rules.md 清理 env；auth/delegates/OAuth delegate 配置与 server-next 完全对齐。

**Architecture:** 业务 cell 不再跑 Cognito Hosted UI，仅做 JWT 校验与 SSO 重定向；登录走 createLoginRedirectRoutes；delegate 走 createDelegateOAuthRoutes + createDelegatesRoutes；配置集中到 backend/config.ts，表增加 pending_client_info；前端登录入口改为 /oauth/login，同意页用 cell-delegates-webui，auth 用 cell-auth-webui 与 server-next 一致。

**Tech Stack:** Hono, cell-cognito-server, cell-delegates-server, cell-delegates-webui, cell-auth-server, cell-auth-webui, DynamoDB (grants + pending_client_info), cell-cli (cell.yaml / env).

**参考设计:** `docs/plans/2026-03-06-image-workshop-sso-delegates-design.md`  
**对齐参考:** `apps/server-next/backend/config.ts`, `apps/server-next/backend/app.ts`, `apps/server-next/backend/controllers/login-redirect.ts`, `apps/server-next/frontend/lib/auth.ts`, `apps/server-next/frontend/App.tsx`

---

## Task 1: cell.yaml 与 env 文件

**Files:**
- Modify: `apps/image-workshop/cell.yaml`
- Modify: `apps/image-workshop/.env.example`
- Create: `apps/image-workshop/.env.local.example`

**Step 1: 修改 cell.yaml**

- 在 `tables` 下新增 `pending_client_info`，与 server-next 一致：
  ```yaml
  pending_client_info:
    keys: { pk: S }
  ```
- 删除 `cognito:` 整块（SSO 模式下本 cell 不填 clientId/hostedUiUrl）。
- 将 `params` 改为与 server-next 对齐：写死 `COGNITO_REGION`、`COGNITO_USER_POOL_ID`（与 SSO 同值，如 `us-east-1`、`us-east-1_gMTKxXOKo`）；仅保留 `LOG_LEVEL: !Env`、`SSO_BASE_URL: !Env`、`BFL_API_KEY: !Secret`。删除 `COGNITO_CLIENT_ID`、`COGNITO_HOSTED_UI_URL`、`GOOGLE_*`、`MICROSOFT_*`。
- 将 `backend.entries.mcp.routes` 改为与 server-next 的 oauth/delegate 对齐：保留 `/api/*`、`/oauth/login`、`/oauth/logout`、`/oauth/register`、`/oauth/token`、`/.well-known/*`、`/mcp`；删除 `/oauth/authorize`、`/oauth/callback`、`/oauth/consent-info`、`/oauth/approve`、`/oauth/deny`（delegate 的 authorize 在 createDelegateOAuthRoutes 内为 POST `/api/oauth/delegate/authorize`，由 `/api/*` 覆盖）。若 cell-cli 要求显式列出 delegate 路径，则增加 `/api/oauth/delegate/authorize` 或保持 `/api/*`。
- 若存在 `app: dev-app.ts` 的 entry，可增加以便本地 dev 与 server-next 一致；若当前仅 `handler: lambda.ts`，则暂不增加，后续 Task 4 再补 dev-app。

**Step 2: 编写 .env.example**

内容与 server-next 对齐的项 + image-workshop 独有项。每项一行，带推荐值；注释说明「每个 !Env/!Secret 必须在此设置」。

示例（按 cell.yaml 的 !Env/!Secret）：
```
# image-workshop — copy to .env and set values.
# Every !Env/!Secret in cell.yaml must be set here. CELL_* injected by cell-cli.

LOG_LEVEL=info
SSO_BASE_URL=https://auth.casfa.shazhou.me
BFL_API_KEY=
```

**Step 3: 编写 .env.local.example**

列出本地必须覆盖的项，带推荐值；注释说明「复制到 .env.local，覆盖 .env」。

示例（对齐 server-next .env.local.example）：
```
# image-workshop — local overrides. Copy to .env.local.
# cell-cli infers DYNAMODB_ENDPOINT from PORT_BASE+2. Every variable here overrides .env.

PORT_BASE=7140
SSO_BASE_URL=http://localhost:7100
LOG_LEVEL=debug
AUTH_COOKIE_DOMAIN=
```

**Step 4: 运行 typecheck**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: 通过（仅改 yaml/env 不影响 TS）。

**Step 5: Commit**

```bash
git add apps/image-workshop/cell.yaml apps/image-workshop/.env.example apps/image-workshop/.env.local.example
git commit -m "chore(image-workshop): cell.yaml + env per cell-config-rules, add pending_client_info"
```

---

## Task 2: 后端 config 模块

**Files:**
- Create: `apps/image-workshop/backend/config.ts`
- Modify: 无（后续 Task 会改为使用 config）

**Step 1: 从 server-next 复制并裁剪 config**

- 打开 `apps/server-next/backend/config.ts`，复制 `ENV_NAMES`、`ServerConfig` 类型、`loadConfig`、`isMockAuthEnabled`。
- 创建 `apps/image-workshop/backend/config.ts`，保留与 image-workshop 相关的字段：
  - `port`、`baseUrl`、`auth`（cookieName、cookieDomain、cookiePath、cookieMaxAgeSeconds、cookieSecure、cognitoRegion、cognitoUserPoolId、mockJwtSecret）、`ssoBaseUrl`、`dynamodbEndpoint`、`dynamodbTableGrants`、`dynamodbTablePendingClientInfo`、`logLevel`。
  - 删除 server-next 独有：`dynamodbTableRealms`、`s3Bucket`、`frontendBucket`、`s3Endpoint`、`maxBranchTtlMs` 等。
  - `loadConfig` 中表名默认值使用 `image-workshop-${stage}-grants`、`image-workshop-${stage}-pending_client_info`。
  - SSO 时 cookie 名为 `"auth"` 的逻辑与 server-next 一致。
- 不在此文件中读取 `BFL_API_KEY`（业务代码仍可从 `process.env.BFL_API_KEY` 读），保持 config 仅负责 auth/delegate/表名。

**Step 2: 运行 typecheck**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/image-workshop/backend/config.ts
git commit -m "feat(image-workshop): add backend config aligned with server-next"
```

---

## Task 3: 复制 login-redirect 并接入 app

**Files:**
- Create: `apps/image-workshop/backend/controllers/login-redirect.ts`
- Modify: `apps/image-workshop/backend/app.ts`

**Step 1: 复制 login-redirect**

- 从 `apps/server-next/backend/controllers/login-redirect.ts` 复制到 `apps/image-workshop/backend/controllers/login-redirect.ts`。
- 将 `ServerConfig` 的 import 改为从 `../config.ts` 引用（image-workshop 的 config）。
- 将 `Env` 的 import 改为从 `../types.ts` 或本 app 的 Hono Env 类型引用；若 image-workshop 尚无 `Env` 类型，在 app 或 types 中定义与 server-next 兼容的 `Variables.auth`。
- `.well-known/oauth-authorization-server` 的 `scopes_supported` 改为 image-workshop 实际提供的 scope 列表，例如 `["use_mcp", "manage_delegates"]`。

**Step 2: 修改 app.ts — 移除旧 OAuth，挂载 login-redirect**

- 删除对 `createOAuthRoutes` 的引用及 `app.route("/", oauthRoutes)`。
- 删除直接使用 `process.env` 的 cognito/cookie 配置，改为从 `deps.config` 读取（先假定 createApp 接收 `config`、`grantStore`、`oauthServer`、`pendingClientInfoStore`；若当前 app 为单文件无 deps，则本 Task 内改为 createApp(deps) 形态，deps 在 Task 4 的入口中注入）。
- 在 auth 中间件之后挂载：`app.route("/", createLoginRedirectRoutes(deps.config, { pendingClientInfoStore: deps.pendingClientInfoStore }))`。
- 确保 `createApp` 的 deps 类型包含 `config`、`pendingClientInfoStore`（grantStore、oauthServer 已有或即将在 Task 4 统一）。

**Step 3: 定义 AppDeps 与 Env**

- 在 app.ts 或 types 中定义 `AppDeps`：`config`（ServerConfig）、`grantStore`、`oauthServer`、`pendingClientInfoStore`；以及 MCP 所需依赖（如无则仅此四项）。
- 定义 `Env` 的 `Variables.auth` 为 user | delegate（与 cell-cognito-server 的 Auth 兼容）。

**Step 4: 运行 typecheck**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: PASS（可能仍有缺失的 createApp 参数，在 Task 4 入口注入后消除）。

**Step 5: Commit**

```bash
git add apps/image-workshop/backend/controllers/login-redirect.ts apps/image-workshop/backend/app.ts
git commit -m "feat(image-workshop): add login-redirect routes, remove old OAuth routes"
```

---

## Task 4: 后端 app 挂载 delegate OAuth 与 delegates，统一入口

**Files:**
- Modify: `apps/image-workshop/backend/app.ts`
- Modify: `apps/image-workshop/backend/lambda.ts`
- Create: `apps/image-workshop/backend/dev-app.ts`（若 cell dev 需与 server-next 一致）

**Step 1: app.ts 增加 delegate OAuth 与 auth 中间件对齐 server-next**

- 在挂载 `createLoginRedirectRoutes` 之后，挂载 `createDelegateOAuthRoutes`（从 `@casfa/cell-delegates-server` 引入 `createDelegateOAuthRoutes`、`createMemoryAuthCodeStore`）。
- 参数与 server-next 一致：`grantStore`、`authCodeStore: createMemoryAuthCodeStore()`、`getUserId: (auth) => auth?.type === "user" ? auth.userId : ""`、`baseUrl: deps.config.baseUrl`、`allowedScopes: ["use_mcp", "manage_delegates"]`、`onAuthorizeSuccess: () => deps.pendingClientInfoStore.delete("mcp")`。
- Auth 中间件：使用 `getTokenFromRequest(c.req.raw, { cookieName: deps.config.auth.cookieName, cookieOnly: false })`，然后 `deps.oauthServer.resolveAuth(token)`，解析结果设置 `c.set("auth", user | delegate)`；类型与 server-next 一致（user 含 userId/email/name/picture，delegate 含 realmId/delegateId/permissions）。
- 保留并确保 `createDelegatesRoutes({ grantStore, getUserId })` 挂载，`getUserId` 与 server-next 一致（从 auth 取 user 的 userId）。

**Step 2: 删除旧 OAuth 控制器与 cognito 块引用**

- 删除对 `backend/controllers/oauth.ts` 的引用；若不再使用可删除文件 `apps/image-workshop/backend/controllers/oauth.ts`。
- 确保 app 内无 `COGNITO_CLIENT_ID`、`COGNITO_HOSTED_UI_URL`、Google/Microsoft 等引用。

**Step 3: lambda.ts 与 dev-app.ts 使用 config + 注入 deps**

- 在 `apps/image-workshop/backend/lambda.ts` 中：从 `loadConfig()` 读 config；用 config 构建 DynamoDB client、`createDynamoGrantStore`、`createDynamoPendingClientInfoStore`；构建 `CognitoConfig`（仅 region、userPoolId；SSO 时 clientId/hostedUiUrl 为空）；`createCognitoJwtVerifier` 或测试用 `createMockJwtVerifier`；`createOAuthServer`（仅 resolveAuth，permissions 含 use_mcp、manage_delegates）；调用 `createApp({ config, grantStore, oauthServer, pendingClientInfoStore })` 得到 app，`export const handler = handle(app)`。
- 新建 `apps/image-workshop/backend/dev-app.ts`：与 lambda 相同的依赖构建逻辑，最后 `export { app }` 供 cell dev 使用。在 cell.yaml 的 backend.entries.mcp 下增加 `app: dev-app.ts`（与 server-next 的 api entry 一致），以便 `cell dev` 使用该 app。

**Step 4: 运行 typecheck**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/image-workshop/backend/app.ts apps/image-workshop/backend/lambda.ts apps/image-workshop/backend/dev-app.ts
git commit -m "feat(image-workshop): wire delegate OAuth and SSO auth, unified bootstrap"
```

若删除了 oauth.ts：  
`git rm apps/image-workshop/backend/controllers/oauth.ts` 后一并 commit。

---

## Task 5: 前端 auth 与登录入口对齐 server-next

**Files:**
- Modify: `apps/image-workshop/frontend/main.tsx`（或入口与路由所在文件）
- Create or Modify: `apps/image-workshop/frontend/lib/auth.ts`（若无则新建；若有则改为与 server-next 一致）

**Step 1: 增加 /api/info 后端端点（若尚未存在）**

- 在 app.ts 中增加 `GET /api/info`，返回 `{ ssoBaseUrl: config.ssoBaseUrl ?? null }`，供前端 initAuth 使用（与 server-next 一致）。

**Step 2: 前端 auth 初始化（cell-auth-webui）**

- 若 image-workshop 当前使用 `@casfa/cell-auth-client`，改为使用 `@casfa/cell-auth-webui` 的 `createAuthClient`、`createApiFetch`（与 server-next 的 `frontend/lib/auth.ts` 一致）。
- 实现 `initAuth()`：请求 `/api/info` 取 `ssoBaseUrl`；若不存在则报错或降级；然后 `createAuthClient({ ssoBaseUrl, logoutEndpoint: "/oauth/logout", redirectAfterLogout: { path: "/oauth/login" } })`；`createApiFetch` 的 `onUnauthorized` 重定向到 `/oauth/logout`。可选：与 server-next 一致增加 CSRF（`/api/csrf`、csrfCookieName、clearCsrfOnLogout）、`ssoRefreshPath: "/oauth/refresh"`。
- 实现 `useCookieAuthCheck()`：请求 `/api/me`（需后端提供，见下），缓存用户信息并返回 `{ loading, isLoggedIn }`。若后端暂无 `/api/me`，可先返回 200 与 mock 或从 auth 中间件侧读取 user 并实现简单 `/api/me`（返回当前 user 信息）。

**Step 3: 后端 /api/me（若尚未存在）**

- 在 app.ts 中增加 `GET /api/me`，需 auth 中间件；从 `c.get("auth")` 取 user，若 type 为 user 则返回 `{ userId, email, name, picture }`，否则 401。与 server-next 行为一致。

**Step 4: 登录入口改为 /oauth/login**

- 前端「登录」按钮或未登录时的入口：不再跳转本 cell 的 Hosted UI 或 `/oauth/authorize`（用户登录），改为跳转 `/oauth/login`（可带 `return_url`）。与 server-next 的 LoginPage 一致：`window.location.href = \`/oauth/login?return_url=${encodeURIComponent(...)}\``。

**Step 5: 运行 typecheck 与本地检查**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/image-workshop/frontend/main.tsx apps/image-workshop/frontend/lib/auth.ts apps/image-workshop/backend/app.ts
git commit -m "feat(image-workshop): frontend auth and login redirect aligned with server-next"
```

---

## Task 6: 前端 delegate 同意页与路由

**Files:**
- Modify: `apps/image-workshop/frontend/main.tsx`（或新建 App.tsx 做路由，与 server-next 一致）
- 依赖: `@casfa/cell-delegates-webui` 已加入 package.json（若未则 `bun add --no-cache @casfa/cell-delegates-webui` workspace）

**Step 1: 安装 cell-delegates-webui（若未依赖）**

- 在 `apps/image-workshop/package.json` 的 dependencies 中增加 `"@casfa/cell-delegates-webui": "workspace:*"`，根目录执行 `bun install --no-cache`。

**Step 2: 使用 DelegateOAuthConsentPage 作为 /oauth/authorize 落地页**

- 与 server-next 的 `App.tsx` 一致：为 `/oauth/authorize` 提供路由，渲染 `DelegateOAuthConsentPage`，传入 `authorizeUrl="/api/oauth/delegate/authorize"`、`loginUrl="/oauth/login"`、`loading`、`isLoggedIn`（来自 useCookieAuthCheck）、`fetch`（apiFetch）、`scopeDescriptions`（如 use_mcp、manage_delegates 的文案）。
- 删除本 cell 自有的用户 OAuth 同意页（ConsentPage）、Google/Microsoft 登录入口、以及本 cell 的 OAuth callback 页（若仅用于用户登录且已改为 SSO）。保留 delegate 授权后的重定向逻辑（由 cell-delegates-webui 处理）。

**Step 3: 路由与 AuthGuard**

- 与 server-next 一致：`/login`、`/oauth/login` 指向登录页（重定向到 /oauth/login）；`/oauth/authorize` 指向 DelegateOAuthConsentPage；需登录的页面外包一层 AuthGuard（未登录重定向到 `/oauth/login`）。

**Step 4: 运行 typecheck**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/image-workshop/frontend/main.tsx apps/image-workshop/package.json
git commit -m "feat(image-workshop): delegate consent page via cell-delegates-webui"
```

---

## Task 7: 测试与文档

**Files:**
- Modify: `apps/image-workshop/README.md`
- Modify: `apps/image-workshop/backend/middleware/auth.ts`（若类型需与 Env 统一）
- Test: 现有单元测试目录（若有）

**Step 1: 更新 README**

- 说明登录方式为 SSO：配置 `SSO_BASE_URL`，本地开发时复制 `.env.local.example` 为 `.env.local` 并设置 `PORT_BASE`、`SSO_BASE_URL`（如 http://localhost:7100）、`LOG_LEVEL`。列出 `.env.example` 与 `.env.local.example` 的用途（与 cell-config-rules 一致）。

**Step 2: 运行单元测试**

Run: `bun run --cwd apps/image-workshop test` 或 `bun test apps/image-workshop`  
Expected: 全部通过。若有失败，修复依赖注入或 mock（如 grantStore、pendingClientInfoStore 用 memory 实现，与 server-next tests/setup 一致）。

**Step 3: 运行 typecheck**

Run: `bun run --cwd apps/image-workshop typecheck`  
Expected: PASS.

**Step 4: Commit**

```bash
git add apps/image-workshop/README.md
git commit -m "docs(image-workshop): README env and SSO setup"
```

---

## 执行方式说明

计划已保存到 `docs/plans/2026-03-06-image-workshop-sso-delegates-impl.md`。

**两种执行方式：**

1. **Subagent-Driven（本会话）** — 按任务派发子 agent，每任务完成后在本会话内 review，再执行下一任务。
2. **Parallel Session（新会话）** — 在新会话中用 executing-plans skill，在独立 worktree 中按检查点批量执行。

请选择一种方式继续。
