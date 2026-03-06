# Cell OAuth 拆分实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 cell-oauth 能力按设计拆入 cell-auth-server（仅 user token）、cell-delegates-server（grant store + verifyDelegateToken + 路由）、cell-cognito-server（SSO 用 OAuth 服务器）；业务 cell 与 SSO cell 不再依赖 cell-oauth，cell-oauth 废弃。

**Architecture:** 先迁 cell-delegates-server（类型、store、token、verifyDelegateToken、createDelegatesRoutes 新入参），再 cell-auth-server（UserAuth、verifyUserToken），再 cell-cognito-server（createOAuthServer），最后改各 app 依赖与代码并移除 cell-oauth。

**Tech Stack:** TypeScript, Bun, Hono, DynamoDB SDK, jose/JWT；包结构沿用现有 workspace 与 build 脚本。

**Design doc:** `docs/plans/2026-03-06-cell-oauth-split-design.md`

---

## Phase 1: cell-delegates-server 迁入 delegate 全量逻辑

### Task 1.1: cell-delegates-server 增加 types

**Files:**
- Create: `packages/cell-delegates-server/src/types.ts`
- Modify: `packages/cell-delegates-server/src/index.ts`

**Step 1:** 从 `packages/cell-oauth/src/types.ts` 复制并只保留 delegate 相关类型到 `packages/cell-delegates-server/src/types.ts`：DelegatePermission、DelegateAuth、DelegateGrant、DelegateGrantStore。删除与 OAuth 相关的 OAuthMetadata、RegisteredClient、CallbackResult、ConsentInfo、TokenResponse、UserAuth。

**Step 2:** 在 `packages/cell-delegates-server/src/index.ts` 中 export 上述类型。

**Step 3:** 运行 `cd packages/cell-delegates-server && bun run typecheck`，预期通过。

**Step 4:** Commit：`feat(cell-delegates-server): add delegate types`

---

### Task 1.2: cell-delegates-server 迁入 token 工具

**Files:**
- Create: `packages/cell-delegates-server/src/token.ts`
- Modify: `packages/cell-delegates-server/src/index.ts`

**Step 1:** 从 `packages/cell-oauth/src/token.ts` 复制全部内容到 `packages/cell-delegates-server/src/token.ts`（sha256Hex、generateDelegateId、generateRandomToken、createDelegateAccessToken、decodeDelegateTokenPayload、verifyCodeChallenge）。

**Step 2:** 在 cell-delegates-server 的 index 中 export 这些函数（或按需只导出 createDelegateAccessToken、decodeDelegateTokenPayload、sha256Hex、generateDelegateId、generateRandomToken、verifyCodeChallenge）。

**Step 3:** typecheck 通过后 commit：`feat(cell-delegates-server): add token utils`

---

### Task 1.3: cell-delegates-server 迁入 createDynamoGrantStore

**Files:**
- Create: `packages/cell-delegates-server/src/dynamo-grant-store.ts`
- Modify: `packages/cell-delegates-server/package.json`

**Step 1:** 从 `packages/cell-oauth/src/dynamo-grant-store.ts` 复制到 `packages/cell-delegates-server/src/dynamo-grant-store.ts`，import 的 types 改为从 `./types.ts` 引用。

**Step 2:** 在 `packages/cell-delegates-server/package.json` 的 dependencies 中添加 `@aws-sdk/client-dynamodb`、`@aws-sdk/lib-dynamodb`（版本与 cell-oauth 一致或 workspace 约定）。

**Step 3:** 在 index 中 export createDynamoGrantStore。

**Step 4:** 运行 `bun install --no-cache`（根目录），然后 packages/cell-delegates-server typecheck 通过。Commit：`feat(cell-delegates-server): add createDynamoGrantStore`

---

### Task 1.4: cell-delegates-server 实现 verifyDelegateToken

**Files:**
- Create: `packages/cell-delegates-server/src/verify-delegate-token.ts`（或并入现有文件）
- Modify: `packages/cell-delegates-server/src/index.ts`

**Step 1:** 实现 `verifyDelegateToken(grantStore: DelegateGrantStore, bearerToken: string): Promise<DelegateAuth | null>`：用 decodeDelegateTokenPayload 取 sub/dlg，sha256Hex(bearerToken)，grantStore.getByAccessTokenHash(sub, hash)，有则返回 { type: "delegate", userId: sub, delegateId: grant.delegateId, permissions: grant.permissions }。

**Step 2:** Export verifyDelegateToken 与 DelegateGrantStore 类型。

**Step 3:** 若有现成单元测试（如 cell-oauth 的 token 或 oauth-server 测试），可迁一条验证 delegate token 的测试到 cell-delegates-server；否则本任务仅 typecheck。Commit：`feat(cell-delegates-server): add verifyDelegateToken`

---

### Task 1.5: cell-delegates-server 实现 createDelegate / listDelegates / revokeDelegate

**Files:**
- Create 或 Modify: `packages/cell-delegates-server/src/delegate-ops.ts`（或分散在 store + 本包内）
- Modify: `packages/cell-delegates-server/src/index.ts`

**Step 1:** 从 cell-oauth 的 oauth-server 中抽出 createDelegate、listDelegates、revokeDelegate 逻辑，改为纯函数：createDelegate(grantStore, params)、listDelegates(grantStore, userId)、revokeDelegate(grantStore, delegateId)。createDelegate 内部生成 delegateId、accessToken、refreshToken，insert grant，返回 { grant, accessToken, refreshToken }。

**Step 2:** Export 这三个函数。

**Step 3:** typecheck 通过。Commit：`feat(cell-delegates-server): add createDelegate, listDelegates, revokeDelegate`

---

### Task 1.6: cell-delegates-server 的 createDelegatesRoutes 改为依赖 grantStore

**Files:**
- Modify: `packages/cell-delegates-server/src/index.ts`（或 routes 所在文件）

**Step 1:** CreateDelegatesRoutesDeps 由 `{ oauthServer: OAuthServer, getUserId }` 改为 `{ grantStore: DelegateGrantStore, getUserId }`。路由内 list 改为 listDelegates(grantStore, getUserId(auth))，create 改为 createDelegate(grantStore, { userId: getUserId(auth), ... })，revoke 改为 revokeDelegate(grantStore, delegateId)。移除对 @casfa/cell-oauth 的 import。

**Step 2:** 类型 DelegatesEnv 的 auth 改为可接受 UserAuth | DelegateAuth；若 UserAuth 未在本包定义，可从 cell-auth-server 引用或在本包定义最小兼容类型（仅 type + userId / delegateId + permissions）。

**Step 3:** 从 package.json 移除对 @casfa/cell-oauth 的依赖。根目录 bun install，typecheck。Commit：`refactor(cell-delegates-server): createDelegatesRoutes uses grantStore instead of OAuthServer`

---

## Phase 2: cell-auth-server 增加 user token 验证

### Task 2.1: cell-auth-server 增加 UserAuth 与 verifyUserToken

**Files:**
- Create 或 Modify: `packages/cell-auth-server/src/user-auth.ts`
- Modify: `packages/cell-auth-server/src/index.ts`

**Step 1:** 定义 UserAuth 类型：`{ type: "user"; userId: string; email?: string; name?: string; picture?: string }`。定义 JwtVerifier 接口（与 cell-cognito-server 的 JwtVerifier 兼容）：接受 token 返回 Promise<{ userId, email?, name?, rawClaims? } | null>。

**Step 2:** 实现 verifyUserToken(bearerToken: string, jwtVerifier: JwtVerifier): Promise<UserAuth | null>：调用 jwtVerifier(bearerToken)，成功则映射为 UserAuth。

**Step 3:** Export UserAuth、verifyUserToken（及可选 optionalUserAuth middleware）。若需 optionalUserAuth，在包内实现：从 c 取 token（可由 options.getBearer(c) 注入），先 verifyUserToken，成功则 c.set("auth", result)，然后 next()。

**Step 4:** typecheck。Commit：`feat(cell-auth-server): add UserAuth and verifyUserToken`

---

## Phase 3: cell-cognito-server 迁入 OAuth 授权服务器

### Task 3.1: cell-cognito-server 增加 createOAuthServer 依赖与类型

**Files:**
- Modify: `packages/cell-cognito-server/package.json`
- Create: `packages/cell-cognito-server/src/oauth-server-types.ts`（或合并到 oauth-server.ts）

**Step 1:** 在 cell-cognito-server 的 package.json 中添加依赖：@casfa/cell-delegates-server、@casfa/cell-auth-server。

**Step 2:** 从 cell-oauth 迁入 OAuth 流程用类型：OAuthMetadata、CallbackResult、ConsentInfo、TokenResponse、RegisteredClient、OAuthServerConfig、OAuthServer（接口）。DelegateGrantStore、DelegatePermission 从 cell-delegates-server 引用。

**Step 3:** 根目录 bun install，typecheck。Commit：`chore(cell-cognito-server): add deps and OAuth server types`

---

### Task 3.2: cell-cognito-server 迁入 createOAuthServer 实现

**Files:**
- Create: `packages/cell-cognito-server/src/oauth-server.ts`
- Modify: `packages/cell-cognito-server/src/index.ts`

**Step 1:** 从 `packages/cell-oauth/src/oauth-server.ts` 复制 createOAuthServer 实现到 cell-cognito-server。将 exchangeCodeForTokens、refreshCognitoTokens 改为从本包 cognito-client 引用；grantStore、createDelegate、listDelegates、revokeDelegate、verifyDelegateToken 从 @casfa/cell-delegates-server 引用；Cookie 构建/清除从 @casfa/cell-auth-server 引用。PKCE verifyCodeChallenge 从 cell-delegates-server 引用。

**Step 2:** 导出 createOAuthServer、OAuthServer、OAuthServerConfig。resolveAuth 内 delegate 分支改为调用 cell-delegates-server 的 verifyDelegateToken(grantStore, bearerToken)。

**Step 3:** typecheck 通过。Commit：`feat(cell-cognito-server): add createOAuthServer for SSO cell`

---

## Phase 4: 业务 cell 与 SSO cell 迁移

### Task 4.1: server-next 移除 cell-oauth，改用 auth-server + delegates-server

**Files:**
- Modify: `apps/server-next/package.json`
- Modify: `apps/server-next/backend/index.ts`、`apps/server-next/backend/app.ts`、`apps/server-next/backend/controllers/oauth.ts`、`apps/server-next/backend/services/realm-info.ts`、`apps/server-next/backend/lambda.ts`、`apps/server-next/backend/dev-app.ts`
- Modify: `apps/server-next/tests/setup.ts`
- Modify: `apps/server-next/tsconfig.json`（若有 cell-oauth path）

**Step 1:** package.json 移除 @casfa/cell-oauth；确保有 @casfa/cell-auth-server、@casfa/cell-delegates-server；若需 JWT 校验则保留 @casfa/cell-cognito-server。

**Step 2:** 创建 grantStore：从 cell-delegates-server 的 createDynamoGrantStore 创建；创建 delegate 路由：createDelegatesRoutes({ grantStore, getUserId })。鉴权中间件：先 getTokenFromRequest（或从 Cookie/Bearer 取 token）→ verifyUserToken(token, jwtVerifier) → 若 null 则 verifyDelegateToken(grantStore, token) → 设置 c.set("auth", ...)。

**Step 3:** oauth 控制器中若仍有 buildAuthCookieHeader/buildClearAuthCookieHeader，改为从 cell-auth-server 引用。OAuthServer 类型、createOAuthServer 等从 server-next 中完全移除（业务 cell 不再跑 OAuth 服务器，只做登录重定向到 SSO）。

**Step 4:** tests/setup 中 DelegateGrant、DelegateGrantStore、createOAuthServer 等改为从 cell-delegates-server / cell-cognito-server 按需引用或 mock；若 server-next 不再创建 OAuth server，则 setup 只保留业务所需（如 grantStore mock）。

**Step 5:** 运行 apps/server-next 的 typecheck 与测试。Commit：`refactor(server-next): drop cell-oauth, use cell-auth-server and cell-delegates-server`

---

### Task 4.2: SSO cell (apps/sso) 改用 cell-cognito-server + cell-delegates-server + cell-auth-server

**Files:**
- Modify: `apps/sso/package.json`
- Modify: `apps/sso/backend/index.ts`、`apps/sso/backend/app.ts`、`apps/sso/backend/controllers/oauth.ts`、`apps/sso/backend/lambda.ts`、`apps/sso/backend/dev-app.ts`
- Modify: `apps/sso/tsconfig.json`

**Step 1:** package.json 移除 @casfa/cell-oauth；添加 @casfa/cell-cognito-server、@casfa/cell-delegates-server、@casfa/cell-auth-server（若尚未存在）。

**Step 2:** 使用 cell-delegates-server 的 createDynamoGrantStore 创建 grantStore；使用 cell-cognito-server 的 createOAuthServer({ issuerUrl, cognitoConfig, jwtVerifier, grantStore, permissions }) 创建 OAuth server；OAuth 路由（authorize、callback、token、refresh、发现、注册）挂到 app，Cookie 写/清用 cell-auth-server。

**Step 3:** 所有 OAuthServer、createOAuthServer、createDynamoGrantStore 的 import 改为从 cell-cognito-server、cell-delegates-server 引用。typecheck 与本地启动验证。Commit：`refactor(sso): use cell-cognito-server and cell-delegates-server instead of cell-oauth`

---

### Task 4.3: image-workshop 移除 cell-oauth

**Files:**
- Modify: `apps/image-workshop/package.json`
- Modify: `apps/image-workshop/backend/app.ts`、`apps/image-workshop/backend/controllers/oauth.ts`、`apps/image-workshop/backend/controllers/delegates.ts`、`apps/image-workshop/backend/controllers/mcp.ts`、`apps/image-workshop/backend/middleware/auth.ts`
- Modify: `apps/image-workshop/tsconfig.json`

**Step 1:** 与 server-next 类似：移除 cell-oauth；grantStore 与 createDelegatesRoutes 从 cell-delegates-server 来；鉴权中间件先 user 再 delegate（verifyUserToken + verifyDelegateToken）；Cookie/CSRF 从 cell-auth-server；Auth 类型从 cell-auth-server（UserAuth）与 cell-delegates-server（DelegateAuth）组合。

**Step 2:** typecheck 与测试通过。Commit：`refactor(image-workshop): drop cell-oauth, use cell-auth-server and cell-delegates-server`

---

## Phase 5: 废弃 cell-oauth

### Task 5.1: 移除所有对 cell-oauth 的依赖并删除或 deprecated 包

**Files:**
- Modify: `packages/cell-oauth/package.json`（可选：标记 deprecated）
- Modify: 根目录 `package.json`、`tsconfig.json`、`bun.lock`
- Delete 或保留: `packages/cell-oauth/` 目录（若保留则仅做 deprecated re-export）

**Step 1:** 确认 apps/server-next、apps/sso、apps/image-workshop、packages/cell-delegates-server 的 package.json 中均无 @casfa/cell-oauth。根 workspace 若有 cell-oauth 的 workspaces 引用，移除。

**Step 2:** 若需短期兼容，将 packages/cell-oauth 改为从 cell-cognito-server、cell-delegates-server、cell-auth-server re-export 并设 "deprecated": "Use cell-cognito-server, cell-delegates-server, cell-auth-server instead"。否则删除 packages/cell-oauth 目录。

**Step 3:** 根目录 bun install --no-cache，全仓库 typecheck。Commit：`chore: remove cell-oauth package (or deprecate with re-exports)`

---

## 执行选项

计划已保存到 `docs/plans/2026-03-06-cell-oauth-split-impl.md`。

**两种执行方式：**

1. **Subagent-Driven（本会话）** — 按任务派发子 agent，每步审查后再进行下一步，迭代快。
2. **独立会话并行执行** — 在新会话中用 executing-plans，在独立 worktree 中按检查点批量执行。

需要哪种？
