# Delegate OAuth 提取 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 delegate OAuth 逻辑提取到 cell-delegates-server（AuthCodeStore + createDelegateOAuthRoutes），同意页提取到新建 cell-delegates-webui（DelegateOAuthConsentPage），server-next 删除 mcp-oauth 并接入上述包；不保留向前兼容，路径统一为 /api/oauth/delegate/*。

**Architecture:** 见 `docs/plans/2026-03-06-delegate-oauth-extract-design.md`。Client = delegate，请求不带 client_id，每次同意创建新 delegate；redirect_uri 仅存在于 auth code 临时存储；scope 可选，同意页展示权限列表；refresh_token 在本次实现。

**Tech Stack:** Hono, React, MUI (webui), existing grantStore/token utils in cell-delegates-server.

---

## Task 1: cell-delegates-server — AuthCodeStore 接口与内存实现

**Files:**
- Create: `packages/cell-delegates-server/src/auth-code-store.ts`
- Modify: `packages/cell-delegates-server/src/index.ts`（export）

**Step 1: 定义接口与类型**

在 `auth-code-store.ts` 中：

```ts
export type AuthCodeEntry = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  createdAt: number;
};

export type AuthCodeStore = {
  set(code: string, entry: AuthCodeEntry): void | Promise<void>;
  get(code: string): AuthCodeEntry | null | Promise<AuthCodeEntry | null>;
  delete(code: string): void | Promise<void>;
};
```

**Step 2: 实现 createMemoryAuthCodeStore**

同一文件内，TTL 5 分钟，内部 Map + 在 set/get 时清理过期：

```ts
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export function createMemoryAuthCodeStore(): AuthCodeStore {
  const map = new Map<string, AuthCodeEntry>();
  function clean() {
    const now = Date.now();
    for (const [k, v] of map) {
      if (now - v.createdAt > AUTH_CODE_TTL_MS) map.delete(k);
    }
  }
  return {
    set(code, entry) {
      clean();
      map.set(code, entry);
    },
    get(code) {
      clean();
      const e = map.get(code);
      if (!e || Date.now() - e.createdAt > AUTH_CODE_TTL_MS) return null;
      return e;
    },
    delete(code) {
      map.delete(code);
    },
  };
}
```

**Step 3: 在 index.ts 中 export**

- Export `AuthCodeStore`, `AuthCodeEntry`, `createMemoryAuthCodeStore` from `./auth-code-store.ts`.

**Step 4: 运行 typecheck**

- Run: `bun run --cwd packages/cell-delegates-server typecheck`  
- Expected: PASS

**Step 5: Commit**

```bash
git add packages/cell-delegates-server/src/auth-code-store.ts packages/cell-delegates-server/src/index.ts
git commit -m "feat(cell-delegates-server): add AuthCodeStore interface and memory impl"
```

---

## Task 2: cell-delegates-server — createDelegateOAuthRoutes（authorize + token）

**Files:**
- Create: `packages/cell-delegates-server/src/delegate-oauth-routes.ts`
- Modify: `packages/cell-delegates-server/src/index.ts`

**Step 1: 定义 Deps 类型与工厂**

- Deps: `{ grantStore: DelegateGrantStore; authCodeStore?: AuthCodeStore; getUserId: (auth: unknown) => string; baseUrl: string; allowedScopes?: string[] }`.
- 若未传 authCodeStore，使用 createMemoryAuthCodeStore()。
- allowedScopes 默认 `["use_mcp"]`（可加 file_read, file_write 等按设计 doc）。

**Step 2: 实现 POST /api/oauth/delegate/authorize**

- 从 c.get("auth") 取 auth，getUserId(auth) 得 userId；无 auth 或 userId 空则 401。
- 解析 body: client_name?, redirect_uri, state, code_challenge, code_challenge_method?, scope?.
- 校验 redirect_uri、state、code_challenge 必填；scope 按 allowedScopes 过滤，非法则 400。
- createDelegate(grantStore, { userId, clientName: client_name?.trim() || "Delegate", permissions: scope 过滤后的数组 })。
- 生成 code（如 crypto.randomUUID().replace(/-/g, "")），authCodeStore.set(code, { accessToken, refreshToken, expiresIn, codeChallenge, codeChallengeMethod, redirectUri, createdAt }).
- 返回 c.json({ redirect_url: `${redirect_uri}?code=${code}&state=${state}` }).

**Step 3: 实现 POST /oauth/token（authorization_code）**

- grant_type=authorization_code 时：取 code、code_verifier；authCodeStore.get(code)，无则 400 invalid_grant；校验 PKCE（verifyCodeChallenge）；authCodeStore.delete(code)；返回 access_token, refresh_token, expires_in, token_type: "Bearer"；可选带 client_id: delegateId（需在 entry 或从 grant 可查，可在 set 时存 delegateId 进 entry 或从 grant 取）。

**Step 4: 实现 POST /oauth/token（refresh_token）**

- grant_type=refresh_token：取 refresh_token；用 grantStore.getByRefreshTokenHash(userId, hash) 查 grant（需对 refresh_token 做 hash）；若需轮换则生成新 access/refresh 并 updateTokens；返回新 access_token（及可选 refresh_token）。注意 grantStore 的 getByRefreshTokenHash 需要 userId — 可从 refresh_token 对应的 grant 得到 userId，或需在 refresh token 存储时能反查。当前 DelegateGrant 只有 refreshTokenHash，需通过 store 按 hash 查；若 store 无「仅按 refreshTokenHash 查」接口，可本包内扩展接口或在此步用 list + 匹配（仅内存实现时可行）。设计 doc 要求本次实现 refresh，若 getByRefreshTokenHash 必须 userId，则 refresh 请求可要求 body 带 client_id（delegateId）以查 grant，或扩展 store 提供 getByRefreshTokenHash(hash) 返回 grant。为简洁：refresh 请求 body 可带 client_id（delegateId），用 grantStore.get(delegateId) 再校验 refreshTokenHash；或约定 store 增加 getGrantByRefreshTokenHash(hash) 若更简洁。
- 建议：refresh 时 body 带 refresh_token；若 grantStore 无「仅按 refreshTokenHash 查」接口，则 refresh 请求体同时带 **client_id（delegateId）**：grantStore.get(delegateId) 得 grant，sha256Hex(refresh_token) 与 grant.refreshTokenHash 比较，通过则签发新 access_token（及可选新 refresh_token 并 updateTokens）。authorize 的 redirect_url 或 token 响应中可带 client_id（delegateId）供客户端保存以便后续 refresh。

**Step 5: 导出 createDelegateOAuthRoutes 与 Env 类型**

- 路由挂到 Hono，Env 上 Variables.auth 为业务 cell 的 auth 类型（泛型或 unknown）。
- index.ts 导出 createDelegateOAuthRoutes 及所需类型。

**Step 6: 单测（可选但推荐）**

- Create: `packages/cell-delegates-server/src/__tests__/delegate-oauth-routes.test.ts`
- 用例：authorize 无 auth 返回 401；authorize 成功返回 redirect_url；token 用 code 换 token 成功；token 用错误 code 返回 invalid_grant；refresh_token 带 client_id 与 refresh_token 返回新 access_token。

**Step 7: typecheck / test**

- Run: `bun run --cwd packages/cell-delegates-server typecheck` 与 `bun test packages/cell-delegates-server`
- Expected: PASS

**Step 8: Commit**

```bash
git add packages/cell-delegates-server/src/delegate-oauth-routes.ts packages/cell-delegates-server/src/index.ts [test file]
git commit -m "feat(cell-delegates-server): add createDelegateOAuthRoutes (authorize + token + refresh)"
```

---

## Task 3: cell-delegates-webui — 新建包与 DelegateOAuthConsentPage

**Files:**
- Create: `packages/cell-delegates-webui/package.json`, `tsconfig.json`, `src/index.tsx`, `src/DelegateOAuthConsentPage.tsx`
- Modify: 根 `package.json` workspaces；`apps/server-next/package.json` 依赖

**Step 1: 初始化包**

- package.json: name `@casfa/cell-delegates-webui`, peerDependencies react, react-dom；dependencies @mui/material 等（与 server-next 一致）。
- tsconfig 与 build 配置参考 cell-auth-webui 或 server-next frontend。

**Step 2: DelegateOAuthConsentPage 组件**

- Props: authorizeUrl, loginUrl, isLoggedIn, fetch? (default window.fetch), scopeDescriptions? (Record<string, string>).
- useSearchParams() 取 client_name, redirect_uri, state, code_challenge, code_challenge_method, scope（空格或+分隔）。
- 未登录：navigate 或 window.location 到 loginUrl + ?return_url=encodeURIComponent(currentFullUrl)。
- 已登录：展示 Card，标题「授权应用」；展示名 = client_name || "此应用"，TextField 可编辑（clientName state）；若 scope 存在则展示「将授予的权限」列表（scopeDescriptions[scope] 或 scope）；Allow 按钮 POST authorizeUrl body { client_name: clientName, redirect_uri, state, code_challenge, code_challenge_method: code_challenge_method || "S256", scope }；Deny 跳 redirect_uri?error=access_denied&state=...
- 不传 client_id。

**Step 3: 导出与 build**

- src/index.tsx 导出 DelegateOAuthConsentPage。
- 根 workspace 加入 packages/cell-delegates-webui；server-next 前端 dependency 加 @casfa/cell-delegates-webui。

**Step 4: Commit**

```bash
git add packages/cell-delegates-webui packages/cell-delegates-server/src/delegate-oauth-routes.ts
git commit -m "feat(cell-delegates-webui): add DelegateOAuthConsentPage with scope list"
```

---

## Task 4: server-next — 移除 mcp-oauth，接入 cell-delegates-server 与 webui

**Files:**
- Delete: `apps/server-next/backend/controllers/mcp-oauth.ts`
- Modify: `apps/server-next/backend/app.ts`, `apps/server-next/frontend/App.tsx`, `apps/server-next/frontend/pages/`（删除或替换 oauth-authorize-page，改用 webui 组件）
- Modify: `apps/server-next/package.json`（依赖）
- Modify: `apps/server-next/backend/controllers/login-redirect.ts`（若 well-known 需调整）

**Step 1: 后端移除 mcp-oauth，挂载 createDelegateOAuthRoutes**

- app.ts：移除 createMcpOAuthRoutes 的 import 与 app.route；改为 import createDelegateOAuthRoutes（及 createMemoryAuthCodeStore）from @casfa/cell-delegates-server；deps 传 grantStore, authCodeStore: createMemoryAuthCodeStore(), getUserId: (auth) => auth?.type === "user" ? auth.userId : "", baseUrl: deps.config.baseUrl；app.route("/", createDelegateOAuthRoutes(deps))。
- 确保 createDelegateOAuthRoutes 挂载在 auth 中间件之后。

**Step 2: 前端改用 DelegateOAuthConsentPage**

- 删除或保留 oauth-authorize-page 文件；App.tsx 中 /oauth/authorize 路由改为渲染从 @casfa/cell-delegates-webui 导入的 DelegateOAuthConsentPage。
- Props: authorizeUrl="/api/oauth/delegate/authorize", loginUrl="/oauth/login", isLoggedIn 来自 useCookieAuthCheck(), fetch 用 apiFetch；scopeDescriptions 可传默认 { use_mcp: "使用 MCP 接口", ... }。

**Step 3: 更新同意页 URL 参数与校验**

- 前端不再依赖 client_id；必填为 redirect_uri, state, code_challenge；client_name、scope 可选。
- 与 Task 2 的 authorize body 一致：不传 client_id。

**Step 4: cell.yaml**

- 若有 /api/oauth/mcp/* 则删除；保留 /api/oauth/delegate/authorize（或由 /api/* 覆盖）。确认 routes 含 /oauth/token 与 /.well-known/*。

**Step 5: 运行 E2E**

- Run: `bun run --cwd apps/server-next test`（或 cell test）
- 修复因路径/接口变更导致的失败（统一用 /api/oauth/delegate/authorize）。

**Step 6: Commit**

```bash
git add apps/server-next
git commit -m "refactor(server-next): use cell-delegates-server OAuth routes and cell-delegates-webui consent page"
```

---

## Task 5: 清理与文档

**Files:**
- Modify: `packages/cell-cognito-server`（若 server-next 不再使用 getClientInfo/registerClient，可保留供 SSO 用，或从 OAuthServer 移除 delegate 相关；按设计 server-next 不再依赖 cell-cognito-server 的 OAuth 部分做 delegate，故仅 server-next 停用即可）
- Modify: README 或设计 doc 的「变更记录」

**Step 1: 移除 server-next 对 mcp-oauth 的任何引用**

- 确保无残留 import 或路由。

**Step 2: 更新 docs/plans/2026-03-06-delegate-oauth-extract-design.md**

- 在变更记录中注明「实现见 2026-03-06-delegate-oauth-extract-impl.md」。

**Step 3: Commit**

```bash
git add docs/plans
git commit -m "chore: link impl plan to design doc"
```

---

## Execution

Plan complete and saved to `docs/plans/2026-03-06-delegate-oauth-extract-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach do you prefer?
