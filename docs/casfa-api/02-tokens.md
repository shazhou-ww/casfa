# Delegate Token 管理 API

用于管理 Root Delegate 和刷新 Token 的 API 端点。

## 概述

### Delegate 模型

CASFA 使用统一的 Delegate 模型管理授权：

| 层级 | 类型 | 认证方式 | 创建方式 |
|------|------|----------|----------|
| depth=0 | Root Delegate | JWT 直连 | 服务器中间件自动创建 |
| depth>0 | Child Delegate | AT + RT | `POST /api/realm/{realmId}/delegates` |

### 认证流程

```
┌──────────┐        ┌──────────────────┐
│  OAuth   │  JWT   │  Realm Routes    │
│  Login   │───────>│  (全部数据操作)   │
│          │        │  中间件自动创建   │
└──────────┘        │  Root Delegate   │
                    └──────────────────┘
                         │
                         │ JWT (创建子 Delegate)
                         ▼
                    ┌──────────┐
                    │  Child   │  RT → Refresh → 新 RT + AT
                    │ Delegate │  AT → Realm Routes
                    └──────────┘
                         │
                         │ AT (继续转签发)
                         ▼
                    ┌──────────┐
                    │ Grandchild│  RT → Refresh → 新 RT + AT
                    │ Delegate │  AT → Realm Routes
                    └──────────┘
```

### Root Delegate 自动创建

Root Delegate 由服务器的认证中间件在用户首次发起 JWT 请求时自动创建，无需客户端显式调用任何端点。
中间件调用 `getOrCreateRoot(userId, delegateId)` 实现幂等创建，支持并发安全（通过 DynamoDB 条件写入）。

---

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens/refresh` | 旋转 RT → 新 RT + AT | Refresh Token (Bearer) |

---

## POST /api/tokens/refresh

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
POST /api/tokens/refresh
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

## 安全说明

1. **Token 是敏感凭证**：RT 和 AT 应当像密码一样保护，不要记录到日志
2. **RT 一次性使用**：每次 refresh 都会旋转 RT，旧 RT 立即失效
3. **并发安全**：使用条件更新保证同一时间只有一个 refresh 请求成功
4. **Root Delegate 无 Token**：Root 直接使用 JWT，不存在 Token 泄漏风险
5. **合理设置有效期**：AT 默认 1 小时，Delegate 可自定义过期时间
