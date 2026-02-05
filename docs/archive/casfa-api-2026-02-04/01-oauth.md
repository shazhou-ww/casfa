# OAuth 认证 API

用于用户身份认证的 API 端点。

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/oauth/config` | 获取 Cognito 配置 | 无 |
| POST | `/api/oauth/token` | 交换授权码获取 Token | 无 |
| POST | `/api/oauth/login` | 用户登录（邮箱密码） | 无 |
| POST | `/api/oauth/refresh` | 刷新 Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User Token |

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
   - 前端调用 `POST /api/oauth/token`，携带 `code` 和 `code_verifier`
   - CASFA 后端透传给 Cognito Token 端点
   - **Cognito 验证** `SHA256(code_verifier) == code_challenge`
   - 验证通过后返回 tokens

### 安全说明

| 客户端类型 | PKCE 要求 | 说明 |
|------------|----------|------|
| SPA (浏览器) | **必须** | 无法安全存储 client_secret |
| 移动端 App | **必须** | 防止授权码被恶意 App 拦截 |
| 服务端 | 可选 | 已有 client_secret 保护 |

---

## GET /api/oauth/config

获取 Cognito 配置信息，用于前端初始化 OAuth 流程。

### 请求

无需参数

### 响应

```json
{
  "cognitoUserPoolId": "us-east-1_xxxxxx",
  "cognitoClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "cognitoHostedUiUrl": "https://xxx.auth.us-east-1.amazoncognito.com"
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

| 字段 | 类型 | 描述 |
|------|------|------|
| `code` | `string` | OAuth 授权码 |
| `redirect_uri` | `string` | 回调 URL，必须与授权请求时一致 |
| `code_verifier` | `string?` | PKCE verifier，提供时透传给 Cognito 验证 |

### 响应

成功时返回 Cognito Token 响应：

```json
{
  "access_token": "...",
  "id_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 缺少 code 或 redirect_uri |
| 400 | PKCE 验证失败（Cognito 返回 code_verifier 与 code_challenge 不匹配） |
| 502 | Cognito Token 交换失败 |
| 503 | OAuth 未配置 |

---

## POST /api/oauth/login

使用邮箱和密码登录。

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
  "userToken": "JWT Token",
  "refreshToken": "刷新 Token",
  "expiresAt": 1738584000000,
  "user": {
    "id": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
    "email": "user@example.com",
    "name": "用户名"
  },
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误 |
| 401 | 认证失败 |

---

## POST /api/oauth/refresh

使用刷新 Token 获取新的访问 Token。

### 请求

```json
{
  "refreshToken": "刷新 Token"
}
```

### 响应

```json
{
  "userToken": "新的 JWT Token",
  "expiresAt": 1738584000000,
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误 |
| 401 | Token 刷新失败 |

---

## GET /api/oauth/me

获取当前已认证用户的信息。

### 请求

需要 `Authorization` header：

```http
Authorization: Bearer {userToken}
```

### 响应

```json
{
  "userId": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "realm": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 401 | 未认证 |

---

## 用户角色说明

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法访问 CAS 资源 |
| `authorized` | 已授权用户，可以访问自己的 Realm |
| `admin` | 管理员，可以管理所有用户 |
