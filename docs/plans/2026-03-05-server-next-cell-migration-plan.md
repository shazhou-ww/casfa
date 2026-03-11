# server-next Cell 迁移实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 server-next 从 Serverless Framework 迁移到 Cell，统一 Cognito/OAuth/delegate 到 cell 方案，路由与 image-workshop 对齐，表改名 realms/grants，域名 drive.casfa.shazhou.me。

**Architecture:** 在 server-next 增加 cell.yaml，后端接入 cell-cognito + cell-oauth，BranchStore 用 realms 表（BRANCH# 前缀、branchId），Grant 用 cell-oauth createDynamoGrantStore；OAuth/Delegates/MCP 路由与 image-workshop 一致；前端用 cell-auth-client；移除 Serverless 及旧脚本。

**Tech Stack:** Cell (cell-cli)、Hono、cell-cognito、cell-oauth、cell-auth-client、DynamoDB、S3、Vite。

**Design reference:** [2026-03-05-server-next-cell-migration-design.md](./2026-03-05-server-next-cell-migration-design.md)

---

## Task 1: 添加 cell.yaml 与 Cell 依赖

**Files:**
- Create: `apps/server-next/cell.yaml`
- Modify: `apps/server-next/package.json`（添加 @casfa/cell-cognito、@casfa/cell-oauth、cell-cli 或 workspace 引用；scripts 暂不删旧，先加 cell 命令）

**Step 1:** 在 `apps/server-next` 下创建 `cell.yaml`，内容按设计文档第 5 节（name: casfa-next，backend 单 entry，routes 含 /api/*、/oauth/*、/.well-known/*、/mcp，frontend，tables realms+grants，buckets blob，params，cognito，domain drive.casfa.shazhou.me）。

**Step 2:** 在 `apps/server-next/package.json` 的 dependencies 中加入 `@casfa/cell-cognito`、`@casfa/cell-oauth`（workspace:*）；devDependencies 中确保可运行 cell（例如 `"cell": "cell"` 或通过 workspace 的 cell-cli）。根目录 `bun install --no-cache` 拉依赖。

**Step 3:** 在 `apps/server-next/package.json` 的 scripts 中增加 `"cell:dev": "cell dev"`、`"cell:build": "cell build"`、`"cell:test": "cell test"`、`"cell:deploy": "cell deploy"`（具体命令以 repo 内 cell-cli 为准，如 `bunx cell dev`）。

**Step 4:** 从 repo 根执行 `bun run build`（或先 build cell-cli 与 cell-cognito/cell-oauth），确认无报错。

**Step 5:** Commit

```bash
git add apps/server-next/cell.yaml apps/server-next/package.json
git commit -m "chore(server-next): add cell.yaml and cell-cognito/cell-oauth deps"
```

---

## Task 2: Config 与表名/桶名环境变量

**Files:**
- Modify: `apps/server-next/backend/config.ts`

**Step 1:** 在 `config.ts` 中，将 `dynamodbTableDelegates` 改为从 `process.env.DYNAMODB_TABLE_REALMS` 读（fallback 可保留 `casfa-next-dev-realms` 等）；`dynamodbTableGrants` 保持从 `DYNAMODB_TABLE_GRANTS` 读；增加对 `S3_BUCKET_BLOB` 的读取，用于 s3Bucket（优先 `S3_BUCKET_BLOB`，fallback `S3_BUCKET`）。

**Step 2:** 若有 ENV_NAMES 或类型，同步改为 DYNAMODB_TABLE_REALMS、S3_BUCKET_BLOB。

**Step 3:** 运行 `cd apps/server-next && bun run typecheck`（或 tsc --noEmit），确认通过。

**Step 4:** Commit

```bash
git add apps/server-next/backend/config.ts
git commit -m "refactor(server-next): config use REALMS table and S3_BUCKET_BLOB"
```

---

## Task 3: dynamo-branch-store 使用 BRANCH# 与 branchId

**Files:**
- Modify: `apps/server-next/backend/db/dynamo-branch-store.ts`

**Step 1:** 将 `PK_PREFIX` 从 `"DLG#"` 改为 `"BRANCH#"`。

**Step 2:** 在 `branchToItem` 中，写入属性 `branchId: branch.branchId`，不再写 `delegateId`；在 `itemToBranch` 中，从 item 读 `branchId ?? item.delegateId`（兼容旧数据可选），并用于构造 Branch 的 branchId。

**Step 3:** 其他引用 `delegateId` 的 item 读写（如 purgeExpiredBranches 里从 item 取 branchId）统一改为 branchId。

**Step 4:** 运行 `cd apps/server-next && bun run test:unit`，确认 BranchStore 相关单测通过（若有）；无单测则 typecheck 通过即可。

**Step 5:** Commit

```bash
git add apps/server-next/backend/db/dynamo-branch-store.ts
git commit -m "refactor(server-next): BranchStore use BRANCH# prefix and branchId"
```

---

## Task 4: Lambda/App 接入 cell-cognito + cell-oauth（骨架）

**Files:**
- Modify: `apps/server-next/backend/lambda.ts`
- Modify: `apps/server-next/backend/app.ts`

**Step 1:** 在 `lambda.ts` 中，改为从同一份「app 工厂」获取 app（见下），以便 app 由 cell-cognito/cell-oauth 构造。若当前 lambda 直接 createApp(deps)，则保留 deps 构造方式，但 deps 中增加 oauthServer、并改为传入已构造的 oauthServer 与 grantStore（来自 cell-oauth）。

**Step 2:** 在 `app.ts` 中，增加对 `@casfa/cell-cognito`、`@casfa/cell-oauth` 的引用；在 createApp 开头根据 config 创建 cognitoConfig、jwtVerifier（createMockJwtVerifier / createCognitoJwtVerifier）、grantStore（createDynamoGrantStore，表名 config.dynamodbTableGrants）、oauthServer（createOAuthServer，issuerUrl 用 config.apiBaseUrl 或 process.env.APP_ORIGIN）。将 oauthServer 挂到 deps 或 createApp 闭包内。

**Step 3:** 挂载 OAuth 路由：从 cell-oauth 使用与 image-workshop 相同的 createOAuthRoutes(oauthServer)，app.route("/", oauthRoutes)。挂载顺序保持 OAuth 先于需 auth 的路由。

**Step 4:** 增加全局 auth 中间件：对任意请求，取 Authorization Bearer，调用 oauthServer.resolveAuth(token)，将结果 set 到 c.set("auth", ...)。若 resolveAuth 返回 null，再执行现有 branch token 解析逻辑，设置 auth 为 worker 类型。将 cell-oauth 的 Auth (user/delegate) 映射为现有 Env 的 AuthContext（user/delegate 字段对应）。

**Step 5:** 运行 typecheck；若有依赖 createApp 的集成测试，跑一遍。Commit。

```bash
git add apps/server-next/backend/lambda.ts apps/server-next/backend/app.ts
git commit -m "feat(server-next): wire cell-cognito and cell-oauth, mount OAuth routes"
```

---

## Task 5: 挂载 /api/delegates 与 /mcp（规范化路径）

**Files:**
- Modify: `apps/server-next/backend/app.ts`
- Create or Modify: `apps/server-next/backend/controllers/delegates.ts`（或新建与 image-workshop 同形态的 delegates 路由）

**Step 1:** 实现或复用「与 image-workshop 一致」的 delegate 路由：GET /api/delegates、POST /api/delegates、POST /api/delegates/:id/revoke，内部调用 oauthServer.listDelegates(auth.userId)、createDelegate、revokeDelegate。权限校验：requireManageDelegates(auth)（user 或 permissions 含 manage_delegates）。注意 server-next 的 permissions 若用 file_read/file_write/branch_manage/delegate_manage，与 cell-oauth 的 use_mcp/manage_delegates 做映射或统一配置 oauthServer 的 permissions。

**Step 2:** 从 app 中移除对 /api/realm/:realmId/delegates 的挂载（list、assign、revoke），改为挂载新的 createDelegatesRoutes({ oauthServer })。

**Step 3:** 将 MCP 路由从 /api/mcp 改为 /mcp：原 createMcpHandler 挂到 POST /mcp、GET /mcp（及可选 /mcp/*）。移除 /api/mcp 与 /api/mcp/* 的旧路由。

**Step 4:** cell.yaml 中 routes 已包含 /mcp，无需改。运行 typecheck。Commit。

```bash
git add apps/server-next/backend/app.ts apps/server-next/backend/controllers/delegates.ts
git commit -m "feat(server-next): normalize delegates to /api/delegates, MCP to /mcp"
```

---

## Task 6: 移除旧 OAuth/MCP 实现与旧 auth

**Files:**
- Delete: `apps/server-next/backend/auth/cognito-jwks.ts`
- Delete: `apps/server-next/backend/services/mcp-oauth.ts`
- Modify: `apps/server-next/backend/app.ts`（删除 /api/oauth/config、/api/oauth/authorize、/api/oauth/token、/api/oauth/mcp/*、/oauth/callback 的 S3 index.html 逻辑等）
- Modify: `apps/server-next/backend/middleware/auth.ts`（改为仅依赖 oauthServer.resolveAuth + branch token 分支，或内联到 app 的 use 中）

**Step 1:** 删除 cognito-jwks.ts、mcp-oauth.ts。

**Step 2:** 在 app.ts 中删除所有 /api/oauth/* 与 /api/oauth/mcp/* 的路由定义；删除「GET /oauth/callback 从 S3 取 index.html」的逻辑（若 cell-oauth 的 callback 已能处理重定向，前端 SPA 由 CloudFront/S3 提供）。

**Step 3:** 精简 auth 中间件：只保留「从 header 取 Bearer → resolveAuth；若 null 再解析 branch token」的逻辑，并设置 AuthContext（user/delegate/worker）。移除对 createCognitoJwtVerifier 等旧实现的引用。

**Step 4:** 删除对 delegateGrantStore 在「旧 MCP OAuth 流程」中的使用；确保 createApp 仍将 oauthServer 用于 resolveAuth 与 delegates 路由。Run typecheck 与 test:unit。Commit。

```bash
git add apps/server-next/backend/
git commit -m "chore(server-next): remove legacy OAuth/MCP and cognito-jwks"
```

---

## Task 7: 移除 dynamo-delegate-grant-store，lambda 使用 cell-oauth grantStore

**Files:**
- Modify: `apps/server-next/backend/lambda.ts`
- Delete or deprecate: `apps/server-next/backend/db/dynamo-delegate-grant-store.ts`（若再无引用可删）

**Step 1:** 在 lambda.ts（或统一 bootstrap 处）创建 DynamoDBDocumentClient 与 createDynamoGrantStore（来自 @casfa/cell-oauth），表名从 config.dynamodbTableGrants 读；将 grantStore 传给 createOAuthServer，不再使用 createDynamoDelegateGrantStore。

**Step 2:** 确认 app 与 lambda 均不再 import 或使用 dynamo-delegate-grant-store，删除该文件。

**Step 3:** Run typecheck 与 test:unit。Commit。

```bash
git add apps/server-next/backend/lambda.ts
git rm apps/server-next/backend/db/dynamo-delegate-grant-store.ts
git commit -m "refactor(server-next): use cell-oauth createDynamoGrantStore, remove legacy grant store"
```

---

## Task 8: 前端依赖与 cell-auth-client

**Files:**
- Modify: `apps/server-next/frontend/package.json`
- Modify: `apps/server-next/frontend/src/main.tsx`（或入口与 auth 初始化处）
- Modify: `apps/server-next/frontend/src/lib/auth.ts`（或等效）

**Step 1:** 在 frontend 的 package.json 中添加 `@casfa/cell-auth-client`（workspace:*），bun install --no-cache。

**Step 2:** 使用 createAuthClient、createApiFetch（参考 image-workshop frontend/main.tsx），将登录入口改为跳转 /oauth/authorize；在 OAuth callback 页用 code 调 /oauth/token 换 token 并写入 auth 状态。

**Step 3:** 将所有「带 token 的 API 请求」改为通过 cell-auth-client 的 apiFetch（或等价），确保 401 时走登出/重登逻辑。

**Step 4:** Run frontend typecheck 与 build。Commit。

```bash
git add apps/server-next/frontend/
git commit -m "feat(server-next): frontend use cell-auth-client, login via /oauth/authorize"
```

---

## Task 9: 前端 Delegates 与 MCP 端点路径

**Files:**
- Modify: `apps/server-next/frontend/src/**/*.tsx`（调用 delegates 与 MCP 的页面/组件）
- Modify: `apps/server-next/frontend/vite.config.ts`（若有 .well-known 或 MCP 代理）

**Step 1:** 将所有 /api/realm/:realmId/delegates 的请求改为 GET /api/delegates、POST /api/delegates、POST /api/delegates/:id/revoke（realmId 不再从 path 传，由后端从 auth 取）。

**Step 2:** 将 MCP 或 OAuth discovery 的 endpoint 从 /api/mcp 改为 /mcp；.well-known/oauth-authorization-server 保持或改为 /.well-known/oauth-authorization-server（与 cell 路由一致）。

**Step 3:** 若有硬编码的 token_endpoint、registration_endpoint，改为 /oauth/token、/oauth/register。Run build。Commit。

```bash
git add apps/server-next/frontend/
git commit -m "fix(server-next): frontend use /api/delegates and /mcp endpoints"
```

---

## Task 10: 移除 Serverless 与旧脚本

**Files:**
- Delete: `apps/server-next/serverless.yml`
- Modify: `apps/server-next/package.json`（删除 serverless、serverless-* 依赖；scripts 中 dev、deploy、test 等改为 cell 命令）
- Delete or trim: `apps/server-next/scripts/dev.ts`、`scripts/deploy.ts`、`scripts/dev-cognito.ts`、`scripts/e2e-offline.ts` 等（改为使用 cell dev / cell test / cell deploy）

**Step 1:** 删除 serverless.yml。

**Step 2:** 从 package.json 的 devDependencies 移除 serverless、serverless-esbuild、serverless-offline、serverless-parameters、serverless-s3-local；scripts 中 "dev" → "cell dev"（或 "bunx cell dev"），"test" → "cell test"，"test:e2e" → "cell test:e2e"（若 cell 支持），"deploy" → "cell deploy"。保留 typecheck、test:unit 等与 cell 兼容的脚本。

**Step 3:** 删除或归档 scripts 下仅用于 Serverless 的 dev/deploy/e2e-offline 等；若 e2e 由 cell test 接管，则删除 scripts/e2e-offline.ts 或改为调用 cell test。更新 README 与 .env.example（Cell params、PORT_BASE、不再需要 SLS_STAGE 等）。

**Step 4:** 从仓库根运行 `bun run typecheck` 与 `bun run test:unit`（含 server-next）。Commit。

```bash
git add apps/server-next/
git commit -m "chore(server-next): remove Serverless, use cell dev/test/deploy"
```

---

## Task 11: 文档与 .env.example

**Files:**
- Modify: `apps/server-next/README.md`
- Modify: `apps/server-next/.env.example`

**Step 1:** README 中说明：本地开发为 `cell dev`，测试为 `cell test`，部署为 `cell deploy`；环境变量以 cell 的 params 为准（COGNITO_*、MOCK_JWT_SECRET、API_BASE_URL 等）；表为 realms、grants；域名 drive.casfa.shazhou.me。移除 Serverless、stage、sls 相关说明。

**Step 2:** .env.example 中列出 Cell 所需变量（PORT_BASE、COGNITO_*、MOCK_JWT_SECRET、!Secret 等），与 cell.yaml params 对齐；移除 SLS_STAGE、DYNAMODB_TABLE_DELEGATES 等。

**Step 3:** Commit。

```bash
git add apps/server-next/README.md apps/server-next/.env.example
git commit -m "docs(server-next): update README and .env.example for Cell"
```

---

## Task 12: E2E 与收尾验证

**Files:**
- Modify: `apps/server-next/tests/**/*.ts`（若有）
- Modify: 根目录 package.json 的 test 脚本（若需区分 server-next 的 cell test）

**Step 1:** 若 E2E 依赖旧 BASE_URL 或 /api/mcp、/api/realm/.../delegates，更新为 /mcp、/api/delegates；登录流程若依赖旧 /api/oauth/*，改为 /oauth/authorize 与 /oauth/callback。

**Step 2:** 在 server-next 目录执行 `cell dev`，手动验证登录、delegates 列表/创建/撤销、MCP 调用（若可测）。

**Step 3:** 执行 `cell test`（或 test:unit + test:e2e），确保通过。Commit 若有改动。

```bash
git add apps/server-next/tests/
git commit -m "test(server-next): e2e use /mcp and /api/delegates"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-05-server-next-cell-migration-plan.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** – Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** – Open a new session with executing-plans, batch execution with checkpoints.

Which approach?
