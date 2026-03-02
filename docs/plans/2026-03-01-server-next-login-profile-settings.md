# server-next 登录 / Profile / Settings 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 server-next 中接入 Cognito（Google/Microsoft）登录：用 JWKS 校验 JWT，提供只读 GET /api/me（Profile）与 GET/PATCH /api/me/settings（Settings 自存）；保留 MOCK_JWT_SECRET 用于本地/测试。

**Architecture:** 鉴权沿用现有 auth 中间件，新增 Cognito JWKS 校验器；当配置了 COGNITO_* 时使用 Cognito 验签，否则或配置了 MOCK_JWT_SECRET 时保留 mock 解码。Profile 从 JWT claims 拼出；Settings 由新增 UserSettingsStore（首版内存）按 userId 读写，PATCH 做字段白名单。

**Tech Stack:** 现有 Hono + Bun；Cognito JWKS 使用 `fetch` + 本地验签（或轻量 jose/bun 内置）；无 Amplify 服务端依赖。

**依据文档:** [2026-03-01-server-next-login-profile-settings-design.md](./2026-03-01-server-next-login-profile-settings-design.md)

---

## Task 1: 配置扩展（Cognito + Mock）

**Files:**
- Modify: `apps/server-next/src/config.ts`

**Step 1: 扩展 ServerConfig.auth**

在 `config.ts` 的 `ServerConfig['auth']` 中增加：
- `cognitoRegion?: string`
- `cognitoUserPoolId?: string`
- `cognitoClientId?: string`

保持现有 `mockJwtSecret?: string`、`maxBranchTtlMs?: number`。

**Step 2: 在 loadConfig 中读取环境变量**

- `COGNITO_REGION` → auth.cognitoRegion
- `COGNITO_USER_POOL_ID` → auth.cognitoUserPoolId
- `COGNITO_CLIENT_ID` → auth.cognitoClientId

**Step 3: 运行 typecheck**

Run: `cd apps/server-next && bun run typecheck`  
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server-next/src/config.ts
git commit -m "feat(server-next): add Cognito config (region, userPoolId, clientId)"
```

---

## Task 2: Cognito JWKS 校验器（仅验签 + claims）

**Files:**
- Create: `apps/server-next/src/auth/cognito-jwks.ts`

**Step 1: 写 failing test**

Create: `apps/server-next/src/auth/cognito-jwks.test.ts`

- Test: 当 JWKS URL 返回 404 时，createCognitoJwtVerifier 返回的 verifier 对任意 token 应 reject（或 verifier 在首次校验时抛）。
- Test: 当传入空 token 时 verifier 应 reject。

（若项目暂无 test 跑器，可改为 Step 2 后手测；此处假定 `bun test` 已可用。）

**Step 2: Run test to verify it fails**

Run: `cd apps/server-next && bun test src/auth/cognito-jwks.test.ts`  
Expected: FAIL（找不到 createCognitoJwtVerifier 或 404 行为未实现）

**Step 3: 实现 createCognitoJwtVerifier**

Create: `apps/server-next/src/auth/cognito-jwks.ts`

- `createCognitoJwtVerifier(config: { region: string; userPoolId: string; clientId?: string })`: 返回 `(token: string) => Promise<{ sub: string; email?: string; name?: string; picture?: string }>`。
- JWKS URL: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`。
- 实现：fetch JWKS，解析 JWT header 取 `kid`，用对应 key 验签；校验 `iss` = `https://cognito-idp.{region}.amazonaws.com/{userPoolId}`、`exp`、可选 `aud` = clientId；从 payload 取 `sub`、`email`、`name`、`picture` 返回。
- 使用轻量方式验签：可用 `jose` 库（`bun add jose --no-cache`）或自行用 Web Crypto 验 RS256（Cognito 默认）。若用 jose：`import * as jose from 'jose'`，用 `createRemoteJWKSet` + `jwtVerify`。

**Step 4: Run test**

Run: `cd apps/server-next && bun test src/auth/cognito-jwks.test.ts`  
Expected: PASS（或手测：无效 token 401、有效 Cognito token 返回 sub 等）

**Step 5: Commit**

```bash
git add apps/server-next/src/auth/cognito-jwks.ts apps/server-next/src/auth/cognito-jwks.test.ts
git commit -m "feat(server-next): add Cognito JWKS JWT verifier"
```

---

## Task 3: Auth 中间件接入 Cognito 与 Mock 分支

**Files:**
- Modify: `apps/server-next/src/types.ts`
- Modify: `apps/server-next/src/middleware/auth.ts`
- Modify: `apps/server-next/src/app.ts`

**Step 1: 在 auth 中间件中注入 verifier 选择逻辑**

- 在 `createAuthMiddleware(deps)` 中：若 `deps.config?.auth` 存在且 `cognitoRegion` 与 `cognitoUserPoolId` 均有值，则使用 `createCognitoJwtVerifier({ region, userPoolId, clientId })` 作为 jwtVerifier；否则若 `deps.config?.auth?.mockJwtSecret` 存在则继续使用 mock（或现有 mockJwtVerify）；否则默认 mockJwtVerify。
- 类型：`AuthMiddlewareDeps` 增加可选 `config?: ServerConfig`（或仅 `auth?: ServerConfig['auth']`），以便传入 Cognito/Mock 配置。
- **UserAuth 扩展**：在 `types.ts` 中为 `UserAuth` 增加可选字段 `email?: string; name?: string; picture?: string`。当 jwtVerifier 返回这些字段时（Cognito 会返回），中间件构造 UserAuth 时一并写入，供 GET /api/me 直接使用。

**Step 2: app.ts 传入 config**

- `createAuthMiddleware({ ..., config: deps.config })`（或传入 `auth: deps.config.auth`）。

**Step 3: 运行 typecheck**

Run: `cd apps/server-next && bun run typecheck`  
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server-next/src/middleware/auth.ts apps/server-next/src/app.ts
git commit -m "feat(server-next): wire Cognito or mock JWT verifier in auth middleware"
```

---

## Task 4: UserSettingsStore 接口与内存实现

**Files:**
- Create: `apps/server-next/src/db/user-settings.ts`

**Step 1: 定义 Store 接口与类型**

- `UserSettings` 类型：可扩展对象，例如 `{ language?: string; notifications?: boolean }`，首版白名单仅此二字段。
- `UserSettingsStore`: `{ get(userId: string): Promise<UserSettings>; set(userId: string, settings: Partial<UserSettings>): Promise<void> }`（set 为合并语义）。

**Step 2: 实现 createMemoryUserSettingsStore**

- 内存 Map<userId, UserSettings>；get 无则返回 `{}`；set 合并现有与传入（仅允许白名单字段）。

**Step 3: 运行 typecheck**

Run: `cd apps/server-next && bun run typecheck`  
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server-next/src/db/user-settings.ts
git commit -m "feat(server-next): add UserSettingsStore (in-memory)"
```

---

## Task 5: GET /api/me（Profile 只读）

**Files:**
- Create: `apps/server-next/src/controllers/me.ts`
- Modify: `apps/server-next/src/app.ts`

**Step 1: 写 failing test**

- 在 `apps/server-next/src/controllers/me.test.ts` 或集成测试：GET /api/me 无 Authorization 返回 401；Bearer 有效 JWT 返回 200 且 body 含 userId（及可选 email、name、picture）。

**Step 2: Run test**

Expected: FAIL（路由或 controller 未实现）

**Step 3: 实现 GET /api/me**

- `createMeController(deps)`：GET handler 从 `c.get('auth')` 取 auth；仅当 `auth.type === 'user'` 时返回 profile，否则 403。
- 响应体从 UserAuth 拼出：`{ userId: auth.userId; email?: auth.email; name?: auth.name; picture?: auth.picture }`（UserAuth 已在 Task 3 扩展可选字段，Cognito 验签后会带齐）。
- 无需再解码 JWT；delegate/worker 不提供 /api/me 的 profile，返回 403。

**Step 4: 在 app 挂路由**

- `app.use("/api/me", authMiddleware)`；`app.get("/api/me", meController.get)`。
- 仅当 auth.type === 'user' 时返回 profile；delegate/worker 可返回 403 或按设计允许（设计说「可限制为 User」）。

**Step 5: Run test / typecheck**

Expected: PASS

**Step 6: Commit**

```bash
git add apps/server-next/src/controllers/me.ts apps/server-next/src/app.ts
git commit -m "feat(server-next): add GET /api/me profile"
```

---

## Task 6: GET /api/me/settings

**Files:**
- Modify: `apps/server-next/src/app.ts`
- Modify: `apps/server-next/src/index.ts`
- Modify: `apps/server-next/src/controllers/me.ts`

**Step 1: AppDeps 增加 userSettingsStore，index 创建并传入**

- `AppDeps` 增加 `userSettingsStore: UserSettingsStore`；在 `index.ts` 中 `createMemoryUserSettingsStore()` 并传入 `createApp`。

**Step 2: 在 MeController 增加 getSettings**

- `createMeController(deps: { userSettingsStore: UserSettingsStore })`；getSettings 从 auth 取 userId（仅 type === 'user'）；调用 `userSettingsStore.get(userId)`，返回 JSON。

**Step 3: 挂 GET /api/me/settings**

- `app.get("/api/me/settings", authMiddleware, meController.getSettings)`。

**Step 4: Run typecheck**

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server-next/src/controllers/me.ts apps/server-next/src/app.ts apps/server-next/src/index.ts
git commit -m "feat(server-next): add GET /api/me/settings"
```

---

## Task 7: PATCH /api/me/settings（白名单 + 合并）

**Files:**
- Modify: `apps/server-next/src/controllers/me.ts`
- Modify: `apps/server-next/src/app.ts`

**Step 1: 实现 patchSettings**

- 解析 body 为 JSON；白名单过滤（仅保留 `language`、`notifications`）；调用 `userSettingsStore.set(userId, filtered)`。

**Step 2: 挂 PATCH /api/me/settings**

- `app.patch("/api/me/settings", authMiddleware, meController.patchSettings)`。

**Step 3: Run typecheck**

Expected: PASS

**Step 4: Commit**

```bash
git add apps/server-next/src/controllers/me.ts apps/server-next/src/app.ts
git commit -m "feat(server-next): add PATCH /api/me/settings with whitelist"
```

---

## Task 8: /api/info 的 authType

**Files:**
- Modify: `apps/server-next/src/app.ts`

**Step 1: /api/info 的 authType 动态化**

- 当 `config.auth.cognitoUserPoolId` 存在时返回 `authType: "cognito"`，否则 `authType: "mock"`。

**Step 2: Run typecheck**

Expected: PASS

**Step 3: Commit**

```bash
git add apps/server-next/src/app.ts
git commit -m "feat(server-next): expose authType (cognito|mock) in /api/info"
```

---

## 执行方式

计划已保存到 `docs/plans/2026-03-01-server-next-login-profile-settings.md`。

**两种执行方式：**

1. **Subagent-Driven（本会话）**：按任务分发给子 agent，每任务后 review，迭代快。
2. **Parallel Session（新会话）**：在新会话中打开 worktree，使用 @superpowers:executing-plans 按检查点批量执行。

选哪种？

若选 **Subagent-Driven**，需使用 @superpowers:subagent-driven-development。  
若选 **Parallel Session**，在新会话 worktree 中使用 @superpowers:executing-plans。
