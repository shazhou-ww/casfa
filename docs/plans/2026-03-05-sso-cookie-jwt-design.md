# SSO 基于 Cookie 共享 JWT 设计

> 设计稿：单点登录（同父域多 cell 共享登录态），通过 HttpOnly cookie 共享 access token，前端带 credentials，登出时清除 cookie。

## 1. 目标与约束

- **目标**：同父域下多个 cell（如 server-next、image-workshop）共享登录态；用户在一个 cell 登录后，其他 cell 无需再登录即可访问 API。
- **手段**：使用 **HttpOnly cookie** 存储 **access token**，前端不读取该 cookie，仅通过 `credentials: 'include'` 在请求中携带；refresh token 仅存 localStorage，refresh 时由前端在 body 中传 refresh_token。
- **登出**：在一个 cell 登出时清除 cookie（服务端提供清 cookie 的端点），使同父域下所有 cell 都登出。

## 2. 架构与组件职责

### 2.1 复用层（cell-oauth）

在 **cell-oauth** 中新增与 cookie 相关的纯函数（不依赖 Hono）：

- **getTokenFromRequest(req, options)**  
  - 入参：标准 `Request`（或与 Hono `c.req` 兼容）、`{ cookieName?: string }`。  
  - 逻辑：先读 `Authorization: Bearer <token>`，有则返回 token；否则若配置了 `cookieName`，则从 `Cookie` 头解析该 name 的值并返回；否则返回 `null`。

- **buildAuthCookieHeader(token, options)**  
  - 入参：`token: string`，以及 `{ cookieName: string; cookieDomain?: string; cookiePath?: string; cookieMaxAgeSeconds?: number; secure?: boolean }`。  
  - 返回：一条 `Set-Cookie` 的**值**（不含 `Set-Cookie:` 前缀），属性包含 **HttpOnly**、**SameSite=Lax**，以及可选的 Domain、Path、Max-Age、Secure。  
  - 用途：由各 cell 在 `/oauth/token`（及 refresh 成功）的响应头中写入，仅写入 **access token**。

### 2.2 各 cell 后端

- **全局 auth 中间件**  
  - 使用 `getTokenFromRequest(c.req, { cookieName: config.auth.cookieName })` 得到 token；再调用现有 `resolveAuth(token)` 设置 `c.set("auth", ...)`。  
  - 未配置 `cookieName` 时行为与当前一致（仅从 Authorization 读）。

- **写 cookie 的时机**  
  - 仅在 **access token** 上调用 `buildAuthCookieHeader`；**refresh token 不写入 cookie**，仍由前端存 localStorage。  
  - **POST /oauth/token** 成功返回 200 且 body 中有 `access_token` 时：在响应头中追加 `Set-Cookie`（使用本次返回的 `access_token`）。  
  - `grant_type` 为 `authorization_code` 或 `refresh_token` 时，只要成功返回 access_token，都写 cookie；这样 refresh 后所有 cell 都会拿到更新后的 cookie。

- **登出端点**  
  - 提供例如 **POST /oauth/logout**（或 **POST /api/session**）：不校验 body，响应头中设置清除 cookie 的 `Set-Cookie`（如 `cookieName=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`；若配置了 `cookieDomain` 则同样带上 `Domain`，否则带 Domain 的 cookie 可能无法被清除）。

### 2.3 配置

每个 cell 的 config 中增加可选字段（仅当 `cookieName` 有值时才读/写 cookie）：

- `cookieName`：cookie 名称（必填才启用 cookie）。
- `cookieDomain`：可选，不设则当前 host（同域）；设则用于同父域共享（如 `.example.com`）。
- `cookiePath`：可选，默认 `/`。
- `cookieMaxAgeSeconds`：可选，与 access token 有效期对齐。
- `secure`：生产建议 true（可根据 baseUrl 或 NODE_ENV 决定）。

配置来源：从 env 读取（如 `AUTH_COOKIE_NAME`、`AUTH_COOKIE_DOMAIN` 等）。

## 3. 前端（cell-auth-client）

- **createApiFetch**  
  - 所有 `fetch` 调用增加 **`credentials: 'include'`**，以便同域或配置了 `cookieDomain` 的子域请求自动携带 HttpOnly cookie。  
  - 若 `authClient.getAuth()` 有 token，继续在请求头设置 `Authorization: Bearer <token>`；没有则仅依赖 cookie。这样「先登录的 cell」仍用 localStorage 的 token，其他 cell 无 localStorage 时仅凭 cookie 即可通过鉴权。

- **不读 cookie、不把 cookie 同步到 localStorage**  
  - 前端不读取 HttpOnly cookie；未登录的 cell 的 `getAuth()` 可为 `null`，但 API 请求带 credentials 后若服务端从 cookie 能解析出用户则返回 200，即“自动登录”。  
  - 若需在未登录 cell 的 UI 上显示当前用户，可依赖 `/api/me` 等接口在首屏带 credentials 请求一次，用返回的 userId/email 做展示（可选）。

- **登出**  
  - `authClient.logout()` 时：（1）清空 localStorage 的 token/refresh；（2）使用 `credentials: 'include'` 调用服务端登出端点（如 `POST /oauth/logout`）以清除 cookie；（3）再跳转登录页或刷新。这样同一父域下各 cell 的 cookie 都会被清除。

## 4. 数据流与边界情况

- **首次在 cell A 登录**：OAuth 完成后前端拿到 access_token + refresh_token；前端 `setTokens(access_token, refresh_token)` 写入 localStorage；服务端在 `/oauth/token` 响应中 Set-Cookie 写入 access_token（HttpOnly）。之后 cell A 的请求可带 Bearer 或 cookie。
- **在 cell B 打开（同父域）**：localStorage 无 token，`getAuth()` 为 null；请求带 `credentials: 'include'`，浏览器自动带上 cell A 写入的 cookie；服务端从 cookie 读 access token 并 `resolveAuth`，返回 200，即自动登录。
- **Refresh**：仅「有 refresh_token 的 cell」（通常是先登录的那个）可发起 refresh；请求 body 带 `refresh_token`（来自 localStorage）；服务端返回新 access_token 后再次 Set-Cookie，所有 cell 后续请求都会带上新 cookie。
- **登出**：任一处调用 `logout()` → 清 localStorage + 调 `POST /oauth/logout`（带 credentials）→ 服务端清 cookie → 同父域下所有 cell 后续请求无有效 cookie，需重新登录。

## 5. 错误处理与测试

- **无效/过期 cookie**：服务端 `resolveAuth(token)` 返回 null 时与当前一致，不设 auth，下游 auth 中间件返回 401；前端 onUnauthorized 照常触发（如跳转登录页）。
- **未配置 cookie**：`cookieName` 未配置时，不读 cookie、不写 cookie，行为与当前完全一致，可视为兼容路径。
- **测试建议**：  
  - cell-oauth：单测 `getTokenFromRequest`（仅 header、仅 cookie、两者都有时优先 header、无 cookieName 时不读 cookie）、`buildAuthCookieHeader`（含 HttpOnly、Domain、Max-Age、Secure）。  
  - 集成：server-next 在启用 cookie 配置下，POST /oauth/token 后检查响应头含 Set-Cookie；请求不带 Authorization 但带 Cookie 时能 200；POST /oauth/logout 后带同一 cookie 的请求返回 401。  
  - 前端：createApiFetch 的 fetch 调用包含 `credentials: 'include'`；logout 时调用登出端点（可 mock）。

## 6. 小结

| 项目         | 说明 |
|--------------|------|
| Cookie 内容   | 仅 access token；refresh token 仅 localStorage |
| Cookie 属性   | HttpOnly、SameSite=Lax、Secure（生产）、可配置 Domain/Path/Max-Age |
| 写 cookie     | POST /oauth/token 成功时（authorization_code 与 refresh_token 均写） |
| 读 token 顺序 | Authorization Bearer 优先，否则 cookie |
| 登出          | 服务端 POST /oauth/logout 清 cookie；前端 logout() 清 localStorage 并调该接口 |
| 前端          | createApiFetch 使用 `credentials: 'include'`，不读 cookie |
