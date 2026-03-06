# Cell OAuth 拆分设计

> 目标：业务 cell 不再依赖 `@casfa/cell-oauth`；user token 验证进 cell-auth-server，delegate 管理进 cell-delegates-server，SSO 用 OAuth 授权服务器逻辑进 cell-cognito-server / cell-cognito-webui；cell-oauth 废弃。

## 1. 整体架构与包边界

- **cell-auth-server**：Cookie/CSRF、从请求取 token、**仅验证 user token**（Cognito JWT → UserAuth）。
- **cell-delegates-server**：GrantStore（含 createDynamoGrantStore）、list/create/revoke、delegate token 签发与 **verifyDelegateToken**；createDelegatesRoutes。
- **cell-cognito-server**：现有 Cognito 能力 + **给 SSO cell 用的 OAuth 授权服务器逻辑**（handleAuthorize、handleCallback、handleToken、发现、注册）；内部依赖 cell-delegates-server（grant store / createDelegate）、cell-auth-server（写/清 Cookie）。
- **cell-cognito-webui**：SSO 前端共享能力（登录页、同意页等）。
- **cell-oauth**：不再被任何 app 依赖；内容迁出后包删除或短期 deprecated re-export 后删除。

**依赖关系**：

- 业务 cell → cell-auth-server + cell-delegates-server（可选 cell-cognito-server 仅取 jwtVerifier）。
- SSO cell → cell-cognito-server + cell-cognito-webui + cell-delegates-server + cell-auth-server。
- cell-cognito-server → cell-delegates-server、cell-auth-server。

---

## 2. cell-auth-server（仅 user token）

- **已有**：Cookie/CSRF（getTokenFromRequest、buildAuthCookieHeader、validateCsrf 等），不变。
- **新增**：
  - **UserAuth** 类型：`{ type: "user"; userId: string; email?; name?; picture? }`，定义在 cell-auth-server。
  - **verifyUserToken(bearerToken: string, jwtVerifier: JwtVerifier): Promise<UserAuth | null>**，或 Hono middleware **optionalUserAuth(options: { getBearer, jwtVerifier })**；仅验证 user（Cognito JWT），不解析 delegate token。
- **不包含**：Delegate 类型、grant store、delegate token 校验。

---

## 3. cell-delegates-server（grant store + verifyDelegateToken + 路由）

- **迁入自 cell-oauth**：
  - 类型：DelegateAuth、DelegateGrant、DelegateGrantStore、DelegatePermission。
  - 实现：createDynamoGrantStore、token 工具（createDelegateAccessToken、decodeDelegateTokenPayload、sha256Hex、generateDelegateId、generateRandomToken、verifyCodeChallenge 等）、基于 store 的 list/insert/remove/getByAccessTokenHash/getByRefreshTokenHash/updateTokens。
  - 对外 API：
    - **createDynamoGrantStore(config) => DelegateGrantStore**
    - **verifyDelegateToken(grantStore, bearerToken): Promise<DelegateAuth | null>**
    - **createDelegate(grantStore, params)**、**listDelegates(grantStore, userId)**、**revokeDelegate(grantStore, delegateId)**（供 SSO 流与 createDelegatesRoutes 复用）。
- **createDelegatesRoutes**：入参改为 **{ grantStore: DelegateGrantStore, getUserId }**，内部调用上述 list/create/revoke，不再依赖 OAuthServer；auth 类型为 UserAuth | DelegateAuth（UserAuth 来自 cell-auth-server 或业务侧统一类型）。
- **依赖**：仅 DynamoDB SDK、Hono；不依赖 cell-oauth、cell-cognito-server。

---

## 4. cell-cognito-server（SSO 用 OAuth 授权服务器）

- **已有**：Cognito（JWT、code 换 token、refresh），不变。
- **迁入**：createOAuthServer(config)。config 含 issuerUrl、cognitoConfig、jwtVerifier、**grantStore**（由 SSO cell 用 cell-delegates-server 创建并注入）、permissions。行为：handleAuthorize、handleCallback、handleToken（code/refresh）、getMetadata、registerClient；delegate 分支通过 cell-delegates-server 的 grant store / createDelegate 与 verifyDelegateToken 实现。
- **依赖**：cell-delegates-server、cell-auth-server。

---

## 5. 业务 cell 的 auth 中间件修饰（方案 1）

- 从请求取 token（Cookie 或 Bearer）→ 先用 cell-auth-server 的 verifyUserToken（或 optionalUserAuth）→ 若 null 再调 cell-delegates-server 的 verifyDelegateToken(grantStore, token) → 仍 null 则 401 或重定向 SSO。
- 业务 cell 可依赖 cell-cognito-server **仅用于** createCognitoJwtVerifier(cognitoConfig)，不依赖 cell-oauth。
- createDelegatesRoutes 入参为 { grantStore, getUserId }，getUserId 兼容 UserAuth | DelegateAuth。

---

## 6. cell-oauth 废弃与迁移顺序

1. **cell-delegates-server**：迁入 types、createDynamoGrantStore、token 工具、verifyDelegateToken、createDelegate/list/revoke；createDelegatesRoutes 改为 grantStore + 上述函数。
2. **cell-auth-server**：新增 UserAuth、verifyUserToken（或 optionalUserAuth）。
3. **cell-cognito-server**：迁入 createOAuthServer 及 SSO 用类型与 PKCE；SSO cell 改依赖 cognito-server + delegates-server + auth-server。
4. **业务 cell**（server-next、image-workshop）：移除 cell-oauth；auth 中间件「先 user 再 delegate」；createDelegatesRoutes 新入参。
5. **cell-oauth**：删除包，或短期 deprecated re-export 后删除；清理所有引用。

---

## 变更记录

- 2026-03-06：初稿；user token 仅 cell-auth-server、delegate 进 cell-delegates-server、SSO 逻辑进 cell-cognito-server、cell-oauth 废弃。
