# Delegate OAuth 提取设计：cell-delegates-server + cell-delegates-webui

> 将 delegate OAuth 授权逻辑从 server-next 提取到 cell-delegates-server，同意页提取到新建的 cell-delegates-webui。适用于 MCP、Web App 等所有需要 delegate token 的客户端。原则：代码简洁，不考虑向前兼容。

## 1. 目标与原则

- **目标**：delegate OAuth（授权码 + PKCE、同意页、token/refresh）在 cell-delegates-* 中实现，业务 cell（server-next、image-workshop 等）只做挂载与集成。
- **原则**：代码简洁；不保留旧路径/旧行为（无 `/api/oauth/mcp/*` 别名）；client = delegate，不单独维护 OAuth client 存储；redirect_uri 一次性，仅存在于 auth code 记录中。

## 2. 概念约定

- **Client = Delegate**：每次用户同意即创建一个新 delegate；不在请求中传递 client_id，不区分「首次/再次」。
- **client_name**：授权 URL 中可选参数，作为同意页上的「推荐名称」；用户可修改，提交后作为 delegate 的 `clientName`。
- **redirect_uri**：仅用于本次重定向及（可选）token 请求校验；不写入 DelegateGrant，只存在于临时 auth code 记录中。
- **scope**：授权 URL 或 body 中可选；后端 allowlist 校验，同意页展示权限列表；未传则默认 `["use_mcp"]`。

## 3. cell-delegates-server（后端）

### 3.1 存储

- **不新增** OAuth client 存储；不扩展 DelegateGrant 的持久化字段（无 redirectUris）。
- **新增 AuthCodeStore**（接口 + 默认内存实现）：
  - `set(code, entry)`：entry 含 accessToken, refreshToken, expiresIn, codeChallenge, codeChallengeMethod, redirectUri, createdAt。
  - `get(code)` / `delete(code)`；实现侧负责 TTL 清理（如 5 分钟）。

### 3.2 路由

- **createDelegateOAuthRoutes(deps)** 返回 Hono 子应用：
  - **POST /oauth/token**  
    - `grant_type=authorization_code`：从 AuthCodeStore 取 code，校验 PKCE（及可选 redirect_uri），返回 access_token、refresh_token；响应中可带 `client_id`（delegateId）供客户端保存。  
    - `grant_type=refresh_token`：基于 grantStore 实现 refresh，返回新 access_token（及可选新 refresh_token）。
  - **POST /api/oauth/delegate/authorize**  
    - 需已登录（deps 提供 getUserId(auth)）。  
    - Body：client_name（可选）, redirect_uri, state, code_challenge, code_challenge_method（可选）, scope（可选）。不传 client_id。  
    - 创建新 delegate（createDelegate），生成 code 写入 AuthCodeStore，返回 `{ redirect_url }`；可选在 redirect_url 或 token 响应中带 client_id（delegateId）。

- **不提供**：GET client-info、POST /oauth/register。

### 3.3 deps

- grantStore, authCodeStore（可选，不传则包内默认内存）, getUserId(auth), baseUrl。
- 可选：allowedScopes（字符串数组），默认 `["use_mcp", ...]`；scope 校验通过后用于创建 delegate 的 permissions。

### 3.4 依赖

- 仅本包现有 grantStore、createDelegate、token 工具（verifyCodeChallenge 等）、Hono；不依赖 cell-cognito-server。

## 4. cell-delegates-webui（前端）

- **新建包** `@casfa/cell-delegates-webui`。
- **DelegateOAuthConsentPage**：
  - 从 URL 读取：client_name, redirect_uri, state, code_challenge, code_challenge_method, scope。
  - Props：authorizeUrl, loginUrl, isLoggedIn, fetch（可选）, scopeDescriptions（scope → 展示文案，可选）。
  - 未登录 → 跳 loginUrl?return_url=<当前页完整 URL>。
  - 已登录 → 展示「允许 XXX 访问？」、可编辑 client_name、**授权权限列表**（根据 scope + scopeDescriptions 展示）；允许/拒绝。
  - 允许 → POST authorizeUrl，body：client_name, redirect_uri, state, code_challenge, code_challenge_method, scope；不传 client_id。拿到 redirect_url 后跳转。
  - 拒绝 → 跳 redirect_uri?error=access_denied&state=...
- 依赖：React；UI 与 server-next 一致则用 MUI。不依赖后端包。

## 5. server-next 集成

- **删除**：`backend/controllers/mcp-oauth.ts`。
- **后端**：挂载 createDelegateOAuthRoutes(deps)；well-known 保持 issuer/endpoints 指向本 cell；不提供 /api/oauth/mcp/* 别名。
- **前端**：/oauth/authorize 使用 DelegateOAuthConsentPage，传入 authorizeUrl="/api/oauth/delegate/authorize", loginUrl="/oauth/login", isLoggedIn 等；使用 /api/oauth/delegate/authorize 唯一路径。
- **cell.yaml**：routes 含 /api/oauth/delegate/authorize、/oauth/token、/.well-known/* 等，不保留 mcp 路径。

## 6. 错误处理与测试

- **错误**：authorize 400（缺参、scope 非法）、401（未登录）；token 400（缺 code/code_verifier、PKCE 失败）、invalid_grant（code 无效/过期）。JSON 错误体，状态码符合 OAuth 习惯。
- **测试**：cell-delegates-server 内对 createDelegateOAuthRoutes 单测（authorize、code 换 token、refresh）；server-next E2E 覆盖同意页 → 登录 → 同意 → 重定向 → code 换 token → 调用 MCP。保持必要覆盖即可，追求简洁。

## 7. 变更记录

- 2026-03-06：初稿；client=delegate、无 client_id、无 client-info/register、redirect_uri 一次性、scope 与同意页权限列表、简洁无兼容。
- 2026-03-06：实现计划见 `2026-03-06-delegate-oauth-extract-impl.md`。
