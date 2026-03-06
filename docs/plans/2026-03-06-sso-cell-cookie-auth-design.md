# SSO Cell + 纯 Cookie 鉴权设计

> 设计稿：单一 SSO cell 负责 OAuth 登录与 Cookie 发放；业务 cell 仅校验 Cookie + 本域 CSRF；refresh 专用 /oauth/refresh，refresh token 仅通过 HttpOnly cookie 限定在该路径。

## 1. SSO cell 职责与路由

### 1.1 定位与部署

- **应用**：新建 cell，目录 `apps/sso`（或 `apps/auth`），与 server-next、image-workshop 同级。
- **部署**：部署到父域下的子域，例如 `auth.casfa.example.com`，与业务 cell 同父域，以便共享 Cookie（`Domain=.casfa.example.com`）。

### 1.2 路由清单（均由 SSO cell 提供）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/oauth/authorize` | 跳转 Cognito 登录；成功后回到本 cell 的 callback。 |
| GET | `/oauth/callback` | Cognito 回调；用 code 换 token，写 Cookie，再重定向到 `state` 中的 `return_url`。 |
| POST | `/oauth/token` | **仅**用授权码换 token：请求体仅含 `code`（必填）、`code_verifier`（PKCE 时必填），**无需** `grant_type`。成功则写 access + refresh cookie，返回 JSON。 |
| POST | `/oauth/refresh` | **专用**：从 Cookie 读取 refresh token（不读 body）；轮转后写新 access + refresh cookie，返回 200 或 JSON。 |
| POST | `/oauth/logout` | 清除 access、refresh 两个 Cookie（父域），返回 200。 |
| GET | `/.well-known/oauth-authorization-server` | OAuth 发现（供 CLI/MCP 等）。 |
| POST | `/oauth/register` | 动态客户端注册（可选）。 |

- **redirect_uri** 固定为 SSO 自身的 callback（如 `https://auth.xxx/oauth/callback`）。
- **state** 由 SSO 在 authorize 时生成并校验，并编码 **return_url**（业务 cell 提供的登录后回跳 URL）；callback 换完 token、写完 Cookie 后重定向到该 return_url。

### 1.3 Cookie 约定（仅 SSO cell 写入）

SSO **只**写入以下两个 Cookie（父域共享）。**CSRF 不由 SSO 写入**，见第 3 节。

| Cookie 名（可配置） | 用途 | HttpOnly | Path | Domain | SameSite |
|--------------------|------|----------|------|--------|----------|
| `auth` | access token (JWT) | 是 | `/` | 父域 | **Strict** |
| `auth_refresh` | refresh token | 是 | **`/oauth/refresh`** | 父域 | **Strict** |

- Max-Age：access 与 JWT 过期一致；refresh 可 30 天或与业务一致。

#### Cookie 安全要求（必须满足）

所有鉴权与 CSRF 相关 Cookie 需满足以下安全属性，实现时在 `Set-Cookie` 中显式设置：

| 属性 | 要求 | 说明 |
|------|------|------|
| **SameSite** | **Strict** | 仅在同站请求中发送，避免跨站携带，降低 CSRF 与信息泄露风险。同一父域下的子域（如 auth.xxx 与 app.xxx 同属 eTLD+1）视为同站，可正常共享 Cookie。 |
| **Secure** | **必须**（生产环境） | 仅通过 HTTPS 传输；**localhost** 可放宽（不设 Secure），便于本地开发。 |
| **HttpOnly** | **必须**（access / refresh） | 鉴权 Cookie 禁止脚本访问，防止 XSS 窃取 token。CSRF cookie 需被前端读取，故不设 HttpOnly。 |
| **Path** | 最小必要范围 | access 用 `/`；refresh 用 `/oauth/refresh`，仅 refresh 请求携带。 |
| **Domain** | 仅 SSO 共享 Cookie 设父域 | 父域共享时设 `Domain=.example.com`；各 cell 自管的 CSRF cookie 不设 Domain（限定当前 host）。 |

清除 Cookie 时（如登出）必须用相同的 **Path** 与 **Domain** 写 `Max-Age=0`，否则可能无法清除。

### 1.4 SSO cell 配置项（环境变量）

- `AUTH_COOKIE_NAME`、`AUTH_REFRESH_COOKIE_NAME`
- `AUTH_COOKIE_DOMAIN`（父域，如 `.casfa.example.com`）
- `AUTH_REFRESH_COOKIE_PATH`（固定 `/oauth/refresh`）
- `AUTH_COOKIE_MAX_AGE_SECONDS`、`AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS`
- Cognito：`COGNITO_*` 等

**说明**：`CELL_` 前缀的变量（如 `CELL_BASE_URL`、`CELL_STAGE`）由 cell-cli 根据 cell.yaml 与 stage 自动注入，**不要在 .env 中设置**。

---

## 2. 业务 cell 职责

- **不再**实现 `/oauth/authorize`、`/oauth/token`、`/oauth/callback`；仅保留「登录」入口：重定向到 SSO 的 `/oauth/authorize`（`state` 中带 `return_url` 为当前 cell 的 URL）。
- **鉴权中间件**：从 Cookie 读取 access token（与 SSO 约定同一 cookie 名），校验 JWT，设置 `c.set("auth", ...)`；对写操作校验本域 CSRF（见第 3 节）。
- **401**：未登录或 token 无效时重定向到 SSO 登录（带 return_url 回到当前页或首页）。

---

## 3. Double submit（CSRF）：各子域自管

- **csrf_token 不由 SSO 写入**；**每个子域（每个 cell）自己** 签发并校验 CSRF。
- 每个 cell（server-next、image-workshop、以及若 SSO 有改状态接口则 SSO 自身）：
  - 在**本域**写入 `csrf_token` cookie（不设 Domain，或 Domain=当前 host），**限定在自己子域**。
  - **安全要求**：该 cookie 须设置 **SameSite=Strict**、**Secure**（生产）；不设 HttpOnly（前端需读取并带在 header）。
  - 对本域内会改状态的请求（POST/PUT/DELETE/PATCH），要求 `X-CSRF-Token` header 与 cookie 值一致，否则 403。
- 前端：从 `document.cookie` 读取本域 csrf，在请求头中带 `X-CSRF-Token`（可仅对写请求带，或统一带）。

---

## 4. 共享包职责划分

以下为约定包名与使用方；实现时现有代码可能混在 cell-oauth / cell-auth-client 等包中，需按此边界拆分或重命名。

### 4.1 鉴权相关包（Auth）

| 包名 | 使用方 | 职责 |
|------|--------|------|
| **cell-cognito** | SSO **后端** | 基于 Cognito 的登录：JWT 校验、code 换 token、refresh。若未来有多个根域名分别作 SSO，各 SSO 后端仍用此包对接各自 Cognito。 |
| **cell-cognito-webui** | SSO **前端** | 公共登录 UI 组件（如登录页、同意页），供 SSO cell 前端渲染。 |
| **cell-auth** | **业务 cell 后端** | 签发 CSRF cookie、鉴权：从 Cookie 读 access token、校验 JWT、校验 CSRF（double submit）。含 getTokenFromRequest、buildAuthCookieHeader、buildRefreshCookieHeader、getCookieFromRequest、CSRF 的 generate/get/validate/build 等。SSO 后端写/清 access·refresh cookie 时也可复用 cell-auth 的 cookie 构建与清除。 |
| **cell-auth-webui** | **业务 cell 前端** | 封装 fetch（credentials: include、X-CSRF-Token、401 时调 SSO refresh）、logout；**不**用 localStorage 存任何 token，**不**提供 cookieOnly 选项（仅 cookie 鉴权一种模式），**不**读取 auth token。用户信息由业务 cell 的 `/api/me` 提供。 |
| **cell-auth-client** | **业务 client（如 CLI）** | 封装请求时带 **Authorization header**（Bearer token），**不用** cookie 机制；供非浏览器客户端使用。 |

### 4.2 Delegate 相关包（与鉴权解耦）

当前共享包里可能混杂了 delegate（授权/委托）管理逻辑，需单独拆出，不属于「登录 / Cookie 鉴权」范畴：

| 包名 | 使用方 | 职责 |
|------|--------|------|
| **cell-delegates** | **业务 cell 后端** | 将现有 delegate 管理服务端逻辑迁入：创建/撤销/列举 delegate、consent、token 轮转等。 |
| **cell-delegates-webui** | **业务 cell 前端** | 将现有 delegate 管理的前端共享组件与逻辑迁入。 |
| **cell-delegates-client** | **业务 client** | 封装 delegate 管理相关 API 的调用。 |

### 4.3 业务 cell 后端（使用 cell-auth）

- **鉴权**：使用 **cell-auth** 的 `getTokenFromRequest(c.req.raw, { cookieName })`（仅从 Cookie 读），再调用与 SSO 一致的 JWT 校验得到 userId，设置 `c.set("auth", ...)`。
- **CSRF**：GET `/api/csrf` 用 cell-auth 的 `generateCsrfToken` + `buildCsrfCookieHeader` 写本域 csrf cookie；对写操作用 `validateCsrf(..., { headerName: "X-CSRF-Token" })`，不通过则 403。
- **登录入口**：GET `/oauth/login`（或 `/api/login-redirect`）重定向到 `{ssoBaseUrl}/oauth/authorize?state=...`，state 中编码 return_url。

---

## 5. 前端行为

### 5.1 请求发起（createApiFetch）

| 行为 | 说明 |
|------|------|
| **凭证** | 所有请求 `credentials: "include"`，以便携带父域 Cookie（access）与本域 Cookie（csrf）。 |
| **Authorization** | 不设置。鉴权完全依赖 Cookie。 |
| **X-CSRF-Token** | 当配置了 csrfCookieName 时，从 `document.cookie` 解析该 cookie 值，在请求头中设置 `X-CSRF-Token`。建议对所有请求都带（或至少对 POST/PUT/PATCH/DELETE），与后端校验范围一致。 |
| **Content-Type** | 若 body 为 JSON，设置 `Content-Type: application/json`。 |

### 5.2 用户信息与登录态

| 场景 | 行为 |
|------|------|
| **获取当前用户** | 业务 cell 前端（cell-auth-webui）不存 token，通过请求 GET `/api/me`（credentials: include）获取 userId/email 等；结果由调用方缓存或通过 subscribe 通知。 |
| **未登录** | getAuth() 为 null 或 /api/me 返回 401；展示「登录」入口，点击后跳转当前 cell 的登录重定向 URL（如 `/oauth/login`），由后端重定向到 SSO。 |
| **登录后回跳** | SSO callback 完成后重定向到 state.return_url（业务 cell）；浏览器自动携带父域 Cookie，后续请求 /api/me 或业务 API 即已登录。 |

### 5.3 401 与 refresh

| 步骤 | 行为 |
|------|------|
| **收到 401** | 若配置了 ssoBaseUrl + ssoRefreshPath：先 `POST {ssoBaseUrl}{ssoRefreshPath}`，无 body，credentials: include（浏览器会带 refresh cookie）。 |
| **refresh 成功** | 响应 200，SSO 已写新 access/refresh cookie；重试一次原请求。 |
| **refresh 失败或未配置** | 调用 onUnauthorized()：通常为跳转登录页或重定向到 SSO 登录（带 return_url）。 |

### 5.4 登出

| 步骤 | 行为 |
|------|------|
| **调用 logout()** | `fetch(ssoBaseUrl + logoutEndpoint, { method: "POST", credentials: "include" })`，使 SSO 清除 access/refresh cookie。 |
| **后续** | 清除本地可能缓存的用户信息；notify 订阅者；前端跳转登录页或 SSO 登录页。 |

### 5.5 CSRF cookie 的获取

- 在发起会改状态的请求前，需确保本域已有 csrf cookie。可选做法：应用初始化或首次需要时请求业务 cell 的 GET `/api/csrf`（credentials: include），服务端 Set-Cookie；之后 cell-auth-webui 的 createApiFetch 从 document.cookie 读取并带 X-CSRF-Token。

---

## 变更记录

- 2026-03-06：初稿；POST /oauth/token 取消 grant_type；CSRF 改为各子域自写自验；补充 Cookie 安全要求（SameSite=Strict、Secure、HttpOnly、Path/Domain）。
- 2026-03-06：细化第 4 节（共享逻辑与包）与第 5 节（前端行为）为可执行规格。
- 2026-03-06：明确共享包职责：cell-cognito / cell-cognito-webui（SSO）、cell-auth / cell-auth-webui / cell-auth-client（鉴权）、cell-delegates / cell-delegates-webui / cell-delegates-client（delegate 管理，从现有包拆出）；cell-auth-webui 仅 cookie 模式、不存 token；cell-auth-client 仅给 CLI 等、带 Authorization 头不用 cookie。
- 2026-03-06：**已实现拆分**：`@casfa/cell-auth-webui`（前端 cookie-only）与 `@casfa/cell-auth-client`（CLI/Bearer）为两个独立包；server-next SSO 模式使用 cell-auth-webui，非 SSO 使用 cell-auth-client。
