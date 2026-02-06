# 客户端授权申请

用于桌面/CLI 应用向用户申请 Delegate Token 的流程，无需用户手动复制粘贴 Token。

## 概述

### 适用场景

| 场景 | 说明 |
|------|------|
| IDE 插件 | Cursor、VS Code 等编辑器插件 |
| CLI 工具 | 命令行工具的首次认证 |
| 桌面应用 | 原生桌面客户端 |

### 核心特点

- 客户端主动发起申请，生成授权链接引导用户审批
- 用户审批时指定 Token 权限（realm, scope, expiresIn 等）
- 客户端通过轮询获取加密的 Token
- 验证码机制防止钓鱼攻击

---

## 流程概述

```
┌───────────┐                    ┌───────────┐                    ┌────────┐
│  Client   │                    │  Server   │                    │  User  │
└─────┬─────┘                    └─────┬─────┘                    └────┬───┘
      │                                │                               │
      │ 1. Generate clientSecret       │                               │
      │    (local)                     │                               │
      │                                │                               │
      │ 2. POST /tokens/requests       │                               │
      │    {clientName}                │                               │
      │───────────────────────────────>│                               │
      │                                │                               │
      │ 3. {requestId, displayCode,    │                               │
      │     authorizeUrl, expiresAt}   │                               │
      │<───────────────────────────────│                               │
      │                                │                               │
      │ 4. Build full URL (add hash)   │                               │
      │    authorizeUrl#secret=xxx     │                               │
      │                                │                               │
      │ 5. Show link & display code    │                               │
      │    "Verify code: ABCD-1234"    │                               │
      │───────────────────────────────────────────────────────────────>│
      │                                │                               │
      │                                │ 6. User opens link, approves  │
      │                                │    POST /requests/:id/approve │
      │                                │<──────────────────────────────│
      │                                │                               │
      │ 7. GET /requests/:id/poll      │                               │
      │    (polling)                   │                               │
      │───────────────────────────────>│                               │
      │                                │                               │
      │ 8. status: "approved"          │                               │
      │    encryptedToken              │                               │
      │<───────────────────────────────│                               │
      │                                │                               │
      │ 9. Decrypt with clientSecret   │                               │
      │    Save & use token            │                               │
```

### 状态流转

```
            ┌───────────┐
            │  pending  │
            └─────┬─────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
   ┌────┴─────┐  ┌┴────────┐  ┌────┴─────┐
   │ approved │  │ rejected │  │  expired │
   └──────────┘  └──────────┘  └──────────┘
```

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| `pending` | 等待用户审批 | 初始状态 |
| `approved` | 已批准 | 用户调用 approve API |
| `rejected` | 已拒绝 | 用户调用 reject API |
| `expired` | 已过期 | 超过 10 分钟未处理 |

---

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens/requests` | 发起授权申请 | 无 |
| GET | `/api/tokens/requests/:requestId/poll` | 轮询状态（客户端侧） | 无 |
| GET | `/api/tokens/requests/:requestId` | 查看详情（用户侧） | User JWT |
| POST | `/api/tokens/requests/:requestId/approve` | 批准申请 | User JWT |
| POST | `/api/tokens/requests/:requestId/reject` | 拒绝申请 | User JWT |

> **注意**：授权申请不可枚举，无列表 API。只能通过精确 `requestId` 访问。

---

## POST /api/tokens/requests

客户端发起 Token 授权申请。

### 请求

```json
{
  "clientName": "Cursor IDE",
  "description": "AI 编程助手"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clientName` | `string` | 是 | 客户端名称（1-64 字符） |
| `description` | `string` | 否 | 客户端描述（最多 256 字符） |

> **注意**：`clientSecret` 由客户端本地生成，不发送到服务端。

### 响应

```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "displayCode": "ABCD-1234",
  "authorizeUrl": "https://casfa.app/authorize/req_xxxxx",
  "expiresAt": 1738498200000,
  "pollInterval": 5
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `requestId` | `string` | 申请 ID（前缀 `req_`） |
| `displayCode` | `string` | 验证码，`XXXX-YYYY` 格式 |
| `authorizeUrl` | `string` | 授权页面基础 URL（不含 hash） |
| `expiresAt` | `number` | 申请过期时间，10 分钟 |
| `pollInterval` | `number` | 建议轮询间隔（秒） |

### 客户端构造完整 URL

客户端需要自行添加 `#secret=xxx` 到 URL：

```
服务端返回: https://casfa.app/authorize/req_xxxxx
客户端添加: https://casfa.app/authorize/req_xxxxx#secret=CROCKFORD_BASE32_SECRET
```

> **安全说明**：
> - `clientSecret` 通过 URL hash 传递，hash 部分不会发送到服务端日志
> - 只有用户浏览器和客户端知道 `clientSecret`

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_CLIENT_NAME` | 400 | clientName 为空或过长 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

---

## GET /api/tokens/requests/:requestId/poll

客户端轮询授权申请状态。

### 请求

```http
GET /api/tokens/requests/req_xxxxx/poll
```

### 响应（等待中）

```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "pending",
  "clientName": "Cursor IDE",
  "displayCode": "ABCD-1234",
  "requestExpiresAt": 1738498200000
}
```

### 响应（已批准）

```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "approved",
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "encryptedToken": "base64_encrypted_token...",
  "tokenExpiresAt": 1741089600000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `encryptedToken` | `string` | 使用 `clientSecret` 加密的完整 Token（AES-256-GCM） |
| `tokenId` | `string` | Token ID |
| `tokenExpiresAt` | `number` | Token 过期时间 |

> **安全说明**：
> - `encryptedToken` 仅在首次轮询到 `approved` 状态时返回
> - 后续轮询不再返回 `encryptedToken`
> - 客户端需使用本地保存的 `clientSecret` 解密

### 响应（已拒绝）

```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "rejected"
}
```

### 响应（已过期）

```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "expired"
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 授权申请不存在 |
| `RATE_LIMITED` | 429 | 轮询过于频繁 |

---

## GET /api/tokens/requests/:requestId

用户侧查看授权申请详情。

### 请求

```http
GET /api/tokens/requests/req_xxxxx
Authorization: Bearer {jwt}
```

### 响应

```json
{
  "requestId": "req_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "pending",
  "clientName": "Cursor IDE",
  "description": "AI 编程助手",
  "displayCode": "ABCD-1234",
  "createdAt": 1738497600000,
  "expiresAt": 1738498200000
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 授权申请不存在 |
| `REQUEST_EXPIRED` | 400 | 授权申请已过期 |

---

## POST /api/tokens/requests/:requestId/approve

用户批准授权申请。

### 请求

```http
POST /api/tokens/requests/req_xxxxx/approve
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "realm": "usr_abc123",
  "type": "delegate",
  "name": "Cursor IDE Token",
  "expiresIn": 2592000,
  "canUpload": true,
  "canManageDepot": false,
  "scope": ["cas://depot:MAIN"],
  "clientSecret": "CROCKFORD_BASE32_SECRET"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `realm` | `string` | 是 | 授权的 Realm ID |
| `type` | `"delegate" \| "access"` | 是 | Token 类型 |
| `name` | `string` | 是 | Token 名称 |
| `expiresIn` | `number` | 否 | 有效期（秒） |
| `canUpload` | `boolean` | 否 | 是否允许上传 |
| `canManageDepot` | `boolean` | 否 | 是否允许管理 Depot |
| `scope` | `string[]` | 是 | 授权范围 |
| `clientSecret` | `string` | 是 | 从 URL hash 读取的 clientSecret |

> **注意**：`clientSecret` 由前端从 URL hash 中读取并附加到请求中。服务端不存储 `clientSecret`。

### 响应

```json
{
  "success": true,
  "tokenId": "dlt1_4xzrt7y2m5k9bqwp3fnhjc6d",
  "expiresAt": 1741089600000
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 授权申请不存在 |
| `REQUEST_EXPIRED` | 400 | 授权申请已过期 |
| `REQUEST_ALREADY_PROCESSED` | 400 | 授权申请已被处理 |
| `INVALID_REALM` | 400 | 无权访问指定的 Realm |
| `INVALID_CLIENT_SECRET` | 400 | clientSecret 格式无效 |

---

## POST /api/tokens/requests/:requestId/reject

用户拒绝授权申请。

### 请求

```http
POST /api/tokens/requests/req_xxxxx/reject
Authorization: Bearer {jwt}
```

### 响应

```json
{
  "success": true
}
```

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `REQUEST_NOT_FOUND` | 404 | 授权申请不存在 |
| `REQUEST_EXPIRED` | 400 | 授权申请已过期 |
| `REQUEST_ALREADY_PROCESSED` | 400 | 授权申请已被处理 |

---

## 验证码设计

验证码用于防止钓鱼攻击，确保用户审批的是正确的客户端请求。

### 格式

`XXXX-YYYY`（8 字符，Crockford Base32 字符集）

**Crockford Base32 字符集**：`0123456789ABCDEFGHJKMNPQRSTVWXYZ`（排除 I, L, O, U 避免混淆）

### 显示要求

客户端必须清晰展示验证码和授权链接：

```
╔════════════════════════════════════════════════════════════════════╗
║                                                                  ║
║  Open the link below to authorize:                               ║
║                                                                  ║
║  https://casfa.app/authorize/req_xxxxx#secret=0A1B2C3D4E5F6G7H   ║
║                                                                  ║
║  Display Code: ABCD-1234                                         ║
║  Please verify the code before approving.                        ║
║                                                                  ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## 加密方案

### clientSecret 生成

客户端本地生成 128 位随机数，使用 Crockford Base32 编码（26 字符）：

```typescript
function generateClientSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return crockfordBase32Encode(bytes);
}
```

### Token 加密

服务端使用 AES-256-GCM 加密 Token：

```typescript
function encryptToken(token: Uint8Array, clientSecret: string): string {
  const key = deriveKey(clientSecret);  // HKDF-SHA256
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = aesGcmEncrypt(token, key, iv);
  return base64Encode(concat(iv, encrypted));
}
```

### Token 解密

客户端使用 `clientSecret` 解密：

```typescript
function decryptToken(encryptedBase64: string, clientSecret: string): Uint8Array {
  const data = base64Decode(encryptedBase64);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const key = deriveKey(clientSecret);
  return aesGcmDecrypt(ciphertext, key, iv);
}
```

---

## 安全考量

1. **requestId 不可猜测**：使用 128 位随机数，不可枚举
2. **clientSecret 不发送到服务端**：通过 URL hash 传递，hash 不会出现在服务器日志
3. **加密保护 Token**：即使中间人截获轮询响应，也无法解密 Token
4. **验证码防钓鱼**：用户通过核对验证码确认请求来源
5. **短有效期**：授权申请 10 分钟过期，减少攻击窗口
