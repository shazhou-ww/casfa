# Delegate Token 管理 API

用于创建 Root Delegate 和刷新 Token 的 API 端点。

## 概述

### Delegate 模型

CASFA 使用统一的 Delegate 模型管理授权：

| 层级 | 类型 | 认证方式 | 创建端点 |
|------|------|----------|----------|
| depth=0 | Root Delegate | JWT 直连 | `POST /api/tokens/root` |
| depth>0 | Child Delegate | AT + RT | `POST /api/realm/{realmId}/delegates` |

### 认证流程

```
┌──────────┐        ┌──────────┐        ┌──────────────────┐
│  OAuth   │  JWT   │  Root    │  JWT   │  Realm Routes    │
│  Login   │───────>│  Token   │───────>│  (全部数据操作)   │
│          │        │  /root   │        │                  │
└──────────┘        └──────────┘        └──────────────────┘
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

---

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/tokens/root` | 创建/获取 Root Delegate | User JWT |
| POST | `/api/tokens/refresh` | 旋转 RT → 新 RT + AT | Refresh Token (Bearer) |

---

## POST /api/tokens/root

创建（或获取已有的）Root Delegate。Root Delegate 是用户在某个 Realm 的最高权限授权实体。

> **幂等**：如果用户已有 Root Delegate，直接返回已有实体（HTTP 200），不会创建重复的。首次创建返回 HTTP 201。

### 请求

```http
POST /api/tokens/root
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "realm": "usr_abc123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `realm` | `string` | 是 | 目标 Realm（必须等于用户自己的 ID） |

### 响应

```json
{
  "delegate": {
    "delegateId": "dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC",
    "realm": "usr_abc123",
    "depth": 0,
    "canUpload": true,
    "canManageDepot": true,
    "createdAt": 1738497600000
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `delegate.delegateId` | `string` | Root Delegate ID |
| `delegate.realm` | `string` | Realm ID |
| `delegate.depth` | `number` | 深度，固定为 0 |
| `delegate.canUpload` | `boolean` | 是否允许上传（Root 默认 true） |
| `delegate.canManageDepot` | `boolean` | 是否允许管理 Depot（Root 默认 true） |
| `delegate.createdAt` | `number` | 创建时间（epoch 毫秒） |

> **注意**：Root Delegate 不返回 RT 和 AT。Root 操作直接使用 JWT 即可访问所有 Realm 路由。

### 错误

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| `INVALID_REALM` | 400 | 不能为其他用户的 Realm 创建 Root |
| `ROOT_DELEGATE_REVOKED` | 403 | Root Delegate 已被撤销，需联系管理员 |
| `UNAUTHORIZED` | 401 | JWT 无效 |

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
