# server-next 登录与用户信息设计

**状态：** 已确认  
**日期：** 2026-03-01

## 1. 范围与目标

- **登录**：仅支持通过 **AWS Cognito** 使用 **Google / Microsoft** 账号登录；用户持 Cognito 签发的 **JWT** 访问 server-next。
- **Profile**：只读，来源于 Cognito（JWT claims 或必要时 Cognito API）；提供 **GET /api/me** 返回当前用户 profile。
- **Settings**：由 server-next 存储、按 userId 读写；**GET /api/me/settings**、**PATCH /api/me/settings**，仅当前用户可访问。
- **不做**：admin 用户管理、Cognito 用户名密码登录、除 Google/Microsoft 外的 IdP、Profile 的修改接口。

## 2. 方案选择

采用 **Cognito User Pool + Google/Microsoft 联盟**：

- 创建 Cognito User Pool，在 Federation 中配置 Google、Microsoft 为 IdP（OIDC）。
- 前端使用 Cognito Hosted UI 或 Amplify Auth 登录，获得 Cognito 签发的 JWT（id_token / access_token）。
- server-next 使用 Cognito JWKS 校验 JWT，从 `sub` 得到 userId（= realmId）。
- Profile：GET `/api/me` 从 JWT claims 拼出（或可选调 Cognito GetUser 补全），只读。
- Settings：自有存储（如 DB 或内存），按 userId 存，GET/PATCH `/api/me/settings`。

## 3. 登录与前端流程

- 前端使用 **Cognito Hosted UI** 或 **Amplify Auth**（如 `signInWithOAuth`）使用 Google/Microsoft 登录。
- Cognito 回调后前端获得 **id_token**（及可选 access_token）；调用 server-next 时在请求头携带 **Authorization: Bearer &lt;id_token 或 access_token&gt;**。
- server-next **不**提供 `/api/auth/login` 等自签 token 的登录端点；登录发生在 Cognito + 前端，server-next 只校验 Bearer JWT。

## 4. server-next 鉴权（Cognito JWT）

- **配置**：Cognito User Pool 的 `region`、`userPoolId`、`clientId`（可选，用于 aud 校验）；JWKS URL：`https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`。
- **校验流程**：收到 Bearer token 且为 JWT 时：
  - 用 JWKS 验签，校验 iss、aud、exp 等；
  - 从 **sub** 得到 **userId**（= realmId）；
  - 与现有逻辑一致：先查 delegateGrant（access token hash）；有 grant → DelegateAuth；无 grant 且 iss 来自 Cognito → UserAuth；非 JWT 的 branch token → WorkerAuth。
- **Mock / 本地**：保留 **MOCK_JWT_SECRET**（或等效配置）；当配置了 mock 且 JWT 用该 secret 签发时，仍按当前逻辑解析为 User/Delegate，不请求 Cognito JWKS。

## 5. Profile API（只读）

- **GET /api/me**
  - 需鉴权（Cognito JWT → User 或 Delegate；若仅允许「用户本人」看 profile，可限制为 User）。
  - 从 JWT claims 拼出 profile：`sub`、`email`、`name`、`picture` 等；若 token 中不全，可选调 Cognito GetUser 补全（需 access_token），否则只返回 claims 中已有字段。
  - 响应示例：`{ userId, email?, name?, picture? }`；不提供 PATCH。

## 6. Settings API（可写）

- **GET /api/me/settings**：需鉴权；按当前 userId 从自有存储读取；若不存在则返回 `{}` 或默认结构。
- **PATCH /api/me/settings**：body 为 JSON 部分更新（如 `{ language: "zh", notifications: true }`）；仅当前 userId 可写；校验 body 格式/白名单字段后合并写入。
- **存储**：新增 **UserSettingsStore**（内存或 DB），key = userId，value = JSON 对象；首版可内存，后续可换持久化。

## 7. 配置与部署

- **环境变量**：`COGNITO_REGION`、`COGNITO_USER_POOL_ID`、`COGNITO_CLIENT_ID`（可选）；`MOCK_JWT_SECRET` 可选（本地/测试）。
- **Cognito 侧**：创建 User Pool，添加 Google 与 Microsoft 为 OIDC IdP，配置 Hosted UI 回调 URL；仅允许 Google/Microsoft 登录（不启用用户名密码）。

## 8. 错误与安全

- 无效/过期 JWT：401，body 如 `{ error: "UNAUTHORIZED", message: "Invalid or expired token" }`。
- 无 token：401。
- Profile/Settings 仅限当前用户，不提供「按 userId 查他人」的接口。
- Settings 的 PATCH 做字段白名单或 schema，避免存过大/非法 JSON。

## 9. 相关文件（当前）

- `apps/server-next/src/app.ts`：路由与中间件挂载
- `apps/server-next/src/middleware/auth.ts`：JWT 解析、delegate 查表、UserAuth/DelegateAuth/WorkerAuth
- `apps/server-next/src/types.ts`：AuthContext、UserAuth 等
- `apps/server-next/src/config.ts`：ServerConfig、loadConfig

## 10. 参考

- 需求与用例：`docs/plans/2026-03-01-requirements-use-cases.md`
- 现有 server OAuth 路由（参考用）：`apps/server/backend/src/router.ts`（`/.well-known/oauth-authorization-server`、`/api/oauth/*`、`/api/auth/authorize/*`、`/api/auth/token` 等）
