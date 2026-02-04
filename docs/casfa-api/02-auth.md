# Auth 授权 API

用于管理 AWP 客户端和 Agent Token 的 API 端点。

## AWP 客户端管理

AWP (Agent Web Portal) 客户端使用 P256 公钥进行认证。

### 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/clients/init` | 初始化认证流程 | 无 |
| GET | `/api/auth/clients/:clientId` | 获取客户端状态 | 无 |
| POST | `/api/auth/clients/complete` | 完成授权 | User Token |
| GET | `/api/auth/clients` | 列出已授权客户端 | User Token |
| DELETE | `/api/auth/clients/:clientId` | 撤销客户端 | User Token |

---

### POST /api/auth/clients/init

初始化 AWP 客户端认证流程。客户端生成 P256 密钥对后调用此接口。

#### 请求

```json
{
  "pubkey": "P256 公钥（Base64 或 PEM 格式）",
  "clientName": "客户端名称"
}
```

#### 响应

```json
{
  "clientId": "client:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "authUrl": "https://example.com/auth/client?id=xxx",
  "displayCode": "ABCD",
  "expiresIn": 600,
  "pollInterval": 5
}
```

| 字段 | 描述 |
|------|------|
| `clientId` | 客户端 ID（公钥的 Blake3s 哈希） |
| `authUrl` | 用户授权页面 URL |
| `displayCode` | 验证码，显示给用户核对 |
| `expiresIn` | 过期时间（秒） |
| `pollInterval` | 建议的轮询间隔（秒） |

---

### GET /api/auth/clients/:clientId

获取客户端状态（等待授权或已授权）。

#### 路径参数

| 参数 | 描述 |
|------|------|
| `clientId` | 客户端 ID（从 init 响应获取） |

#### 响应

已授权：

```json
{
  "status": "authorized",
  "clientId": "client:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "clientName": "My Agent",
  "expiresAt": 1709294400000
}
```

等待中：

```json
{
  "status": "pending",
  "clientId": "client:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "expiresAt": 1709294400000
}
```

未找到（404）：

```json
{
  "status": "not_found",
  "error": "No pending or authorized client found"
}
```

---

### POST /api/auth/clients/complete

用户确认授权后完成客户端认证。

#### 请求

需要 `Authorization` header：

```http
Authorization: Bearer {userToken}
```

```json
{
  "clientId": "client:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "verificationCode": "ABCD"
}
```

#### 响应

```json
{
  "success": true,
  "clientId": "client:A6JCHNMFWRT90AXMYWHJ8HKS90",
  "expiresAt": 1709294400000
}
```

#### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 验证码无效、已过期或待授权记录不存在 |
| 401 | 需要用户认证 |

---

### GET /api/auth/clients

列出当前用户已授权的 AWP 客户端。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "clients": [
    {
      "clientId": "client:01HQXK5V8N3Y7M2P4R6T9W0DEF",
      "pubkey": "P256 公钥",
      "clientName": "My Agent",
      "createdAt": 1738497600000,
      "expiresAt": 1741089600000
    }
  ]
}
```

---

### DELETE /api/auth/clients/:clientId

撤销指定的 AWP 客户端授权。

#### 请求

需要 `Authorization` header

路径参数：

- `clientId`: 客户端 ID

#### 响应

```json
{
  "success": true
}
```

#### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | 客户端不存在或无权限 |

---

## Agent Token 管理

Agent Token 是为 AI Agent 创建的长期访问令牌。

### Token 格式

| 字段 | 格式 | 说明 |
|------|------|------|
| Token 值 | `casfa_{base32}` | 240-bit 随机数的 Crockford Base32 编码（48 字符），共 54 字符 |
| Token ID | `token:{hash}` | Token 值的 Blake3s 哈希 |

> **安全设计**：
>
> - 服务端**不保存** Token 值，仅保存 Token ID（hash）
> - Token 值仅在创建时返回一次
> - 鉴权时，服务端计算请求中 Token 的 hash，查询数据库验证

### 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/tokens` | 创建 Agent Token | User Token |
| GET | `/api/auth/tokens` | 列出 Agent Token | User Token |
| DELETE | `/api/auth/tokens/:id` | 撤销 Agent Token | User Token |

---

### POST /api/auth/tokens

创建一个新的 Agent Token。

#### 请求

需要 `Authorization` header

```json
{
  "name": "My AI Agent",
  "description": "用于自动化任务的 Agent",
  "expiresIn": 2592000
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | Token 名称（必填） |
| `description` | `string?` | 描述 |
| `expiresIn` | `number?` | 有效期（秒），默认 30 天 |

#### 响应

```json
{
  "id": "token:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "token": "casfa_0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEF",
  "name": "My AI Agent",
  "description": "用于自动化任务的 Agent",
  "expiresAt": 1741089600000,
  "createdAt": 1738497600000
}
```

> **注意**: `token` 字段仅在创建时返回一次，请妥善保存。列表接口不会返回 token 内容。

---

### GET /api/auth/tokens

列出当前用户的所有 Agent Token。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "tokens": [
    {
      "id": "token:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "name": "My AI Agent",
      "description": "用于自动化任务的 Agent",
      "expiresAt": 1741089600000,
      "createdAt": 1738497600000
    }
  ]
}
```

---

### DELETE /api/auth/tokens/:id

撤销指定的 Agent Token。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "success": true
}
```

#### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | Token 不存在 |
