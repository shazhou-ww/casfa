# image-workshop SSO + cell-delegates 改造设计

> 参考 server-next 对 image-workshop 做一轮改造：复用 SSO 登录、复用 cell-delegates-*、按 docs/cell-config-rules.md 清理 env。  
> **原则：auth、delegates 管理、OAuth delegate 授权相关的配置与行为与 server-next 完全对齐。**

---

## 1. 架构与整体流程

**角色**  
改造后 image-workshop 与 server-next 一致：业务 cell，不跑 Cognito Hosted UI。用户登录走 SSO 重定向；鉴权仅做同一 Cognito User Pool 的 JWT 校验；本 cell 作为 delegate 的 issuer，提供 delegate OAuth（authorize + token）供 MCP 等客户端拿 token 调 `/mcp`。

**路由分工**  
- **SSO 相关**：`/oauth/login`（重定向到 SSO）、`/oauth/logout`（清 cookie 再重定向到本 cell `/oauth/login`）、`/.well-known/oauth-authorization-server`（本 cell 作为 delegate issuer 的发现）、`/oauth/register`（MCP 动态注册 stub）。
- **Delegate OAuth**：`/oauth/authorize`、`/oauth/token`；同意页使用 cell-delegates-webui，行为与 server-next 一致。
- **业务**：`/mcp`（需 user 或 delegate token，且 delegate 具 `use_mcp`）。

**数据流**  
- 用户登录：前端 → 本 cell `/oauth/login?return_url=...` → 302 SSO `/login` → SSO + Cognito → SSO 写 cookie → 302 回 `return_url`；本 cell 不提供用户级 `/oauth/callback`/`/oauth/token`。
- MCP delegate：客户端请求 `/oauth/authorize` → 已登录则展示同意页（cell-delegates-webui）→ 同意后重定向带 code → 客户端用 code 调本 cell `/oauth/token` 得 delegate access_token → 用该 token 调 `/mcp`。

---

## 2. 后端模块与配置（与 server-next 对齐）

**设计原则**：auth、delegates 管理、OAuth delegate 授权相关的配置与 server-next 完全对齐（同一套 env 名、同一套 config 结构、同一套路由与 store 用法）。

### 2.1 Config

- 新增 `backend/config.ts`，形态对齐 server-next：
  - 从 env 读取：`CELL_BASE_URL`、`SSO_BASE_URL`、`COGNITO_REGION`、`COGNITO_USER_POOL_ID`、`LOG_LEVEL`、`DYNAMODB_ENDPOINT`、`DYNAMODB_TABLE_GRANTS`、`DYNAMODB_TABLE_PENDING_CLIENT_INFO`；测试时 `MOCK_JWT_SECRET`、`CELL_STAGE`。
  - **Auth**：与 server-next 一致。有 `SSO_BASE_URL` 时 cookie 名为 `"auth"`（与 SSO 一致）；`cookieDomain`、`cookiePath`、`cookieMaxAgeSeconds`、`cookieSecure` 从 env 或推导。
  - **Delegates / OAuth delegate**：仅需 `baseUrl`、表名（grants、pending_client_info），无额外配置。
- image-workshop 独有：仅保留与 BFL 等业务相关的配置（如读 `BFL_API_KEY` 的路径），不混入 auth/delegate 的 env 命名。

### 2.2 App 与路由顺序（对齐 server-next）

1. CORS。
2. **Auth 中间件**：`getTokenFromRequest`（Cookie + Bearer）→ `oauthServer.resolveAuth(token)` → 设置 `c.set("auth", user | delegate)`；未识别的 token 不设 auth。
3. **SSO 与发现**：`createLoginRedirectRoutes(config, { pendingClientInfoStore })` 挂载 `/oauth/login`、`/oauth/logout`、`/.well-known/oauth-authorization-server`、`/oauth/register`（stub，写 pending_client_info）。
4. **Delegate OAuth**：`createDelegateOAuthRoutes({ grantStore, authCodeStore: createMemoryAuthCodeStore(), getUserId, baseUrl, allowedScopes, onAuthorizeSuccess: () => pendingClientInfoStore.delete("mcp") })`。`allowedScopes` 至少含 `use_mcp`、`manage_delegates`（与 server-next 的 delegate 能力对齐，image-workshop 可只暴露 MCP 相关 scope）。
5. 业务路由：`createDelegatesRoutes({ grantStore, getUserId })`、`/mcp` 等。

### 2.3 依赖与 Store（对齐 server-next）

- **OAuthServer**：`createOAuthServer`（cell-cognito-server），仅用于 `resolveAuth`（JWT 校验）；Cognito 只配 `region`、`userPoolId`，SSO 模式下不配 `clientId`/`hostedUiUrl`。
- **GrantStore**：`createDynamoGrantStore`（cell-delegates-server），表名来自 config。
- **PendingClientInfoStore**：`createDynamoPendingClientInfoStore`（cell-delegates-server），表名来自 config。
- **Delegate OAuth**：`createDelegateOAuthRoutes`、`createMemoryAuthCodeStore`（cell-delegates-server）；`getUserId` 从 `auth` 取 user 的 userId（与 server-next 一致）。

### 2.4 表（cell.yaml）

- **grants**：保留，与 server-next 同结构（pk, sk, user-hash-index, user-refresh-index）。
- **pending_client_info**：新增，与 server-next 同结构（pk: S）。
- 无 realms、branch 等 server-next 独有表。

### 2.5 入口（index / dev-app / lambda）

- 与 server-next 一致：从 `loadConfig()` 读配置；用 config 构建 CognitoConfig、grantStore、pendingClientInfoStore、oauthServer；注入 `createApp({ config, grantStore, oauthServer, pendingClientInfoStore, ... })`。image-workshop 无 branch/cas 等，只传上述与 MCP 所需依赖。

---

## 3. 前端（与 server-next 对齐）

- **登录**：入口改为跳转 `/oauth/login`（不再本 cell 的 Hosted UI / 本 cell 的 consent）。
- **Auth 客户端**：与 server-next 一致使用 cell-auth-webui 的 `createAuthClient`（或与 server-next 相同的 auth 初始化方式），`loginUrl` 指向 `/oauth/login`，`logoutEndpoint` 指向 `/oauth/logout`；cookie 由 SSO 写入，同父域共享。
- **Delegate 同意页**：使用 cell-delegates-webui 的 `DelegateOAuthConsentPage`（或与 server-next 相同的同意页组件），路由与 server-next 一致（如 `/oauth/authorize` 展示同意页）。
- **Callback**：若 SSO 登录完成后重定向回本 cell 的某 URL（如 `/` 或 `/oauth/callback`），该页仅作落地页，不处理用户级 code；与 server-next 行为一致即可。
- 移除本 cell 自有的用户 OAuth 同意页、Google/Microsoft 登录入口等，改为统一 SSO 登录入口。

---

## 4. cell.yaml 与 env（按 cell-config-rules 清理）

- **cell.yaml**
  - 写死与 server-next 一致且非敏感、本地/线上一致：如 `COGNITO_REGION`、`COGNITO_USER_POOL_ID`（与 SSO 同一 User Pool）。
  - 仅对「敏感或本地/线上可能不同」使用 `!Env` / `!Secret`：`LOG_LEVEL`、`SSO_BASE_URL`、`BFL_API_KEY`（!Secret）。不再声明 `COGNITO_CLIENT_ID`、`COGNITO_HOSTED_UI_URL`、`GOOGLE_*`、`MICROSOFT_*`。
  - 表：`grants`、`pending_client_info`（与 server-next 对齐）。
  - routes：与 server-next 对齐的 oauth 与 delegate 路径（/oauth/login、/oauth/logout、/oauth/register、/.well-known/*、/oauth/authorize、/oauth/token、/mcp、/api/* 等）。
- **.env.example**  
  列出所有 `!Env` / `!Secret` 的 key，每项带推荐值；注释说明「每个 !Env/!Secret 必须在此设置」；与 server-next 的 auth/delegate 相关项命名一致。
- **.env.local.example**  
  列出本地必须覆盖的项（如 `PORT_BASE`、`SSO_BASE_URL`、`LOG_LEVEL`、`AUTH_COOKIE_DOMAIN` 等），每项带推荐值；注释说明「此处列出的项均需在 .env.local 中设置以覆盖 .env」。

---

## 5. 测试与验收

- 单元测试：backend 在现有基础上，对 config、auth 解析、delegate 路由依赖注入方式与 server-next 对齐；若有测试用 mock（如 memory grant store / memory pending client info），与 server-next 的 tests/setup 用法一致。
- E2E（若存在）：登录走 SSO、delegate 授权拿 token 调 `/mcp` 的流程与 server-next 可共用一个套路（同 SSO、同 cookie 域名约定）。
- 验收：本地与部署后，auth、delegates 管理、OAuth delegate 授权相关行为与 server-next 一致；env 符合 cell-config-rules（无可选 !Env、example 带推荐值并提交）。

---

## 6. 实施顺序建议

1. cell.yaml 与 env：加 `pending_client_info` 表，按 cell-config-rules 清理 params，补 `.env.example`、`.env.local.example`。
2. 后端 config：新增 `backend/config.ts`（与 server-next 对齐），去掉对 COGNITO_CLIENT_ID / HOSTED_UI / GOOGLE / MICROSOFT 的依赖。
3. 后端 app：移除 `createOAuthRoutes`，引入 `createLoginRedirectRoutes`、`createDelegateOAuthRoutes`、`PendingClientInfoStore`；鉴权与 delegate 路由顺序、参数与 server-next 一致。
4. 后端入口：index/dev-app/lambda 改为从 config 与 cell-delegates-server 构建 grantStore、pendingClientInfoStore、oauthServer，注入 createApp。
5. 前端：登录改为 `/oauth/login`，delegate 同意页改用 cell-delegates-webui，auth 客户端与 server-next 对齐；删除本 cell 自有用户 OAuth/Google/Microsoft 登录与同意页。
6. 测试与文档：更新 README、env 说明，跑通 typecheck 与测试。

---

*设计原则再强调：auth、delegates 管理、OAuth delegate 授权相关的配置与 server-next 完全对齐。*
