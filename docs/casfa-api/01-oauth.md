# OAuth 认证 API

用于用户身份认证的 API 端点。OAuth 认证后获取的 User JWT 用于管理操作和 Root Delegate 的数据访问。

CASFA 支持两种用户认证方式：Cognito OAuth 和 Local Auth（本地注册/登录）。两者均返回 User JWT，后续流程完全一致。

## 端点列表

### Cognito OAuth

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/oauth/config` | 获取 Cognito 配置 | 无 |
| POST | `/api/oauth/token` | 交换授权码获取 Token | 无 |
| POST | `/api/oauth/login` | 用户登录（邮箱密码） | 无 |
| POST | `/api/oauth/refresh` | 刷新 JWT Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User JWT |

### Local Auth（本地认证）

仅在 `AUTH_MODE=local` 时启用。

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/local/register` | 用户注册 | 无 |
| POST | `/api/local/login` | 用户登录 | 无 |
| POST | `/api/local/refresh` | 刷新 JWT Token | 无 |

---

## PKCE 机制

对于 SPA 和移动端客户端，强烈建议使用 PKCE (Proof Key for Code Exchange) 保护授权码流程，防止授权码拦截攻击。

### PKCE 流程

1. **客户端生成 code_verifier**
   - 生成 43-128 字符的随机字符串（允许字符：`[A-Z] [a-z] [0-9] - . _ ~`）
   - 存储在客户端本地（如 sessionStorage）

2. **计算 code_challenge**

   ```
   code_challenge = BASE64URL(SHA256(code_verifier))
   ```

3. **发起授权请求（跳转 Cognito Hosted UI）**

   ```
   GET https://{cognitoHostedUiUrl}/authorize?
     response_type=code&
     client_id={cognitoClientId}&
     redirect_uri={redirectUri}&
     code_challenge={codeChallenge}&
     code_challenge_method=S256&
     identity_provider=Google
   ```

4. **Cognito 回调返回授权码**

   ```
   GET {redirectUri}?code={authorizationCode}
   ```

5. **交换授权码时提供 code_verifier**
   - 调用 `POST /api/oauth/token`，携带 `code` 和 `code_verifier`

---

## GET /api/oauth/config

获取 Cognito 配置信息，用于前端初始化 OAuth 流程。

### 响应

```json
{
  "userPoolId": "us-east-1_xxxxxx",
  "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "domain": "xxx.auth.us-east-1.amazoncognito.com",
  "region": "us-east-1"
}
```

---

## POST /api/oauth/token

交换 OAuth 授权码获取 Token（用于 Cognito Hosted UI / Google 登录）。

### 请求

```json
{
  "code": "授权码",
  "redirect_uri": "回调 URL",
  "code_verifier": "PKCE verifier (可选)"
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `code` | `string` | 是 | OAuth 授权码 |
| `redirect_uri` | `string` | 是 | 回调 URL，必须与授权请求时一致 |
| `code_verifier` | `string` | 否 | PKCE verifier，提供时透传给 Cognito 验证 |

### 响应

```json
{
  "accessToken": "...",
  "idToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 缺少 code 或 redirect_uri |
| 502 | Token 交换失败 |
| 503 | OAuth 未配置 |

---

## POST /api/oauth/login

使用邮箱和密码登录（Cognito USER_PASSWORD_AUTH 流程）。

### 请求

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### 响应

```json
{
  "accessToken": "...",
  "idToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误 |
| 401 | 认证失败 |

---

## POST /api/oauth/refresh

使用 Cognito Refresh Token 获取新的 JWT Token。

### 请求

```json
{
  "refreshToken": "Cognito Refresh Token"
}
```

### 响应

```json
{
  "accessToken": "新的 Access Token",
  "idToken": "新的 ID Token",
  "expiresIn": 3600
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误 |
| 401 | Token 刷新失败 |

---

## GET /api/oauth/me

获取当前登录用户的信息。

### 请求

```http
Authorization: Bearer {jwt}
```

### 响应

```json
{
  "userId": "usr_A6JCHNMFWRT90AXMYWHJ8HKS90",
  "email": "user@example.com",
  "name": "用户名",
  "realm": "usr_A6JCHNMFWRT90AXMYWHJ8HKS90",
  "role": "authorized",
  "rootDelegateId": "dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC"
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `userId` | `string` | 用户 ID |
| `email` | `string` | 用户邮箱 |
| `name` | `string` | 用户名称 |
| `realm` | `string` | 用户的 Realm（等于 userId） |
| `role` | `string` | 用户角色：`unauthorized`, `authorized`, `admin` |
| `rootDelegateId` | `string \| null` | 用户的 Root Delegate ID（未创建时为 null） |

### 错误

| 状态码 | 描述 |
|--------|------|
| 401 | 未认证或 JWT 无效 |

---

## User JWT 的用途

User JWT 用于以下操作：

| 操作 | 端点 |
|------|------|
| 获取用户信息 | `GET /api/oauth/me` |
| 管理用户（Admin） | `GET /api/admin/users`, `PATCH /api/admin/users/:userId` |
| MCP 调用 | `POST /api/mcp` |
| 访问 Realm 数据（Root Delegate） | 所有 `/api/realm/*` 路由（中间件自动识别 JWT 并自动创建 Root Delegate） |

> **重要**：Root Delegate 在用户首次发起 JWT 请求时由中间件自动创建（通过 `getOrCreateRoot`），无需客户端显式调用任何端点。中间件会自动检测 JWT 格式（包含 `.` 分隔符），验证后转换为与 Access Token 相同的 `AccessTokenAuthContext`，下游中间件和控制器无需区分。

---

## 用户角色

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法创建 Root Delegate |
| `authorized` | 已授权用户，可以创建 Root Delegate 和管理 Token |
| `admin` | 管理员，可以管理所有用户 |

---

## Local Auth（本地认证）

仅在 `AUTH_MODE=local` 时启用，用于开发或私有部署。与 Cognito OAuth 互斥。

### POST /api/local/register

注册新用户。

#### 请求

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### 响应

```json
{
  "accessToken": "...",
  "idToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600
}
```

### POST /api/local/login

用户登录。请求/响应格式与 `POST /api/oauth/login` 一致。

### POST /api/local/refresh

刷新 JWT Token。请求/响应格式与 `POST /api/oauth/refresh` 一致。
