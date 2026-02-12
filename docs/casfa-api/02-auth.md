# Auth API

认证授权相关 API，包括 Token 刷新和客户端授权申请。

## 端点列表

| 方法 | 路径 | 描述 | 认证 | 状态 |
|------|------|------|------|------|
| POST | `/api/auth/refresh` | 旋转 RT → 新 RT + AT | Refresh Token (Bearer) | ✅ 已实现 |
| POST | `/api/auth/request` | 发起授权申请 | 无 | ⚠️ 未实现 |
| GET | `/api/auth/request/:requestId/poll` | 轮询授权状态 | 无 | ⚠️ 未实现 |
| GET | `/api/auth/request/:requestId` | 查看申请详情 | User JWT | ⚠️ 未实现 |
| POST | `/api/auth/request/:requestId/approve` | 批准申请 | User JWT | ⚠️ 未实现 |
| POST | `/api/auth/request/:requestId/deny` | 拒绝申请 | User JWT | ⚠️ 未实现 |

---

## POST /api/auth/refresh

使用 Refresh Token 旋转获取新的 RT + AT 对。

### 机制

1. 从 Authorization header 解析 24 字节 RT（Base64 编码）
2. 从 RT 中提取 delegateId
3. 验证 RT hash 与 delegate 存储的 `currentRtHash` 匹配
4. 生成新 RT + AT 对
5. 原子条件更新：`SET newHashes WHERE currentRtHash = oldHash`
6. 返回新 Token

> **一次性使用**：每个 RT 只能使用一次。使用后旧 RT 失效，必须使用新返回的 RT。如果 RT 被重放（旧 RT 再次使用），请求会被拒绝但 delegate 不会被自动撤销。

### 请求

```http
POST /api/auth/refresh
Authorization: Bearer {base64_encoded_rt}
```

> 注意：RT 通过 Authorization header 传递，请求体为空。

### 响应

```json
{
  "refreshToken": "base64_new_rt...",
  "accessToken": "base64_new_at...",
  "accessTokenExpiresAt": 1738501200000,
  "delegateId": "dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `refreshToken` | `string` | 新 Refresh Token（Base64 编码的 24 字节） |
| `accessToken` | `string` | 新 Access Token（Base64 编码的 32 字节） |
| `accessTokenExpiresAt` | `number` | AT 过期时间（epoch 毫秒），默认 1 小时 |
| `delegateId` | `string` | 关联的 Delegate ID |

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `UNAUTHORIZED` | 401 | 缺少 Authorization header |
| `INVALID_TOKEN_FORMAT` | 401 | RT 不是有效的 24 字节 Base64 |
| `NOT_REFRESH_TOKEN` | 400 | 传入的是 AT（32 字节）而非 RT |
| `ROOT_REFRESH_NOT_ALLOWED` | 400 | Root delegate (depth=0) 使用 JWT，不需要 refresh |
| `DELEGATE_NOT_FOUND` | 401 | Delegate 不存在 |
| `DELEGATE_REVOKED` | 401 | Delegate 已被撤销 |
| `DELEGATE_EXPIRED` | 401 | Delegate 已过期 |
| `TOKEN_INVALID` | 401 | RT hash 不匹配（可能被重放） |
| `TOKEN_INVALID` | 409 | 并发 refresh 冲突 |

---

## 客户端授权申请（未实现）

> **⚠️ 未实现**：以下描述的是设计规划。Protocol 层已定义相关 schemas（`CreateAuthRequestSchema`, `ApproveRequestSchema` 等），但路由和控制器未注册。

用于桌面/CLI 应用向用户申请 Delegate Token 的流程，无需用户手动复制粘贴 Token。

### 适用场景

| 场景 | 说明 |
|------|------|
| IDE 插件 | Cursor、VS Code 等编辑器插件 |
| CLI 工具 | 命令行工具的首次认证 |
| 桌面应用 | 原生桌面客户端 |

### 设计流程

```
┌───────────┐                    ┌───────────┐                    ┌────────┐
│  Client   │                    │  Server   │                    │  User  │
└─────┬─────┘                    └─────┬─────┘                    └────┬───┘
      │                                │                               │
      │ 1. Generate clientSecret       │                               │
      │    (local)                     │                               │
      │                                │                               │
      │ 2. POST /api/auth/request      │                               │
      │    {clientName}                │                               │
      │───────────────────────────────>│                               │
      │                                │                               │
      │ 3. {requestId, displayCode,    │                               │
      │     authorizeUrl, expiresAt}   │                               │
      │<───────────────────────────────│                               │
      │                                │                               │
      │ 4. Show link & display code    │                               │
      │    "Verify code: ABCD-1234"    │                               │
      │───────────────────────────────────────────────────────────────>│
      │                                │                               │
      │                                │ 5. User opens link, approves  │
      │                                │<──────────────────────────────│
      │                                │                               │
      │ 6. GET /api/auth/request/      │                               │
      │    :id/poll (polling)          │                               │
      │───────────────────────────────>│                               │
      │                                │                               │
      │ 7. status: "approved"          │                               │
      │    encryptedToken              │                               │
      │<───────────────────────────────│                               │
      │                                │                               │
      │ 8. Decrypt with clientSecret   │                               │
```

---

## 安全说明

1. **Token 是敏感凭证**：RT 和 AT 应当像密码一样保护，不要记录到日志
2. **RT 一次性使用**：每次 refresh 都会旋转 RT，旧 RT 立即失效
3. **并发安全**：使用条件更新保证同一时间只有一个 refresh 请求成功
4. **Root Delegate 无 Token**：Root 直接使用 JWT，不存在 Token 泄漏风险
5. **合理设置有效期**：AT 默认 1 小时，Delegate 可自定义过期时间
