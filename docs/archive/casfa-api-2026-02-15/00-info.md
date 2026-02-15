# 服务信息 API

提供服务配置信息的公开端点，供客户端和工具查询当前服务状态。

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 无 |
| GET | `/api/info` | 获取服务配置信息 | 无 |

---

## GET /api/health

服务健康检查端点。

### 响应

```json
{
  "status": "ok",
  "service": "casfa"
}
```

---

## GET /api/info

获取服务配置信息，包括存储类型、认证方式、限制参数等。

> **安全说明**: 此端点仅返回公开信息，不会暴露敏感的部署细节（如 bucket 名称、endpoint 地址、凭证等）。

### 响应

```json
{
  "service": "casfa-v2",
  "version": "0.1.0",
  "storage": "memory",
  "auth": "mock",
  "database": "local",
  "limits": {
    "maxNodeSize": 4194304,
    "maxNameBytes": 255,
    "maxCollectionChildren": 10000,
    "maxPayloadSize": 10485760,
    "maxDelegateTokenTtl": 2592000,
    "maxAccessTokenTtl": 86400,
    "maxTokenDepth": 15
  },
  "features": {
    "jwtAuth": true,
    "oauthLogin": true
  }
}
```

### 响应字段说明

#### 顶级字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `service` | string | 服务名称，固定为 `"casfa-v2"` |
| `version` | string | 服务版本号 |
| `storage` | string | 存储后端类型 |
| `auth` | string | 认证方式 |
| `database` | string | 数据库类型 |
| `limits` | object | 服务限制参数 |
| `features` | object | 功能开关状态 |

#### `storage` 可选值

| 值 | 说明 |
|------|------|
| `memory` | 内存存储（开发/测试用，重启后数据丢失） |
| `fs` | 文件系统存储（本地开发用） |
| `s3` | AWS S3 存储（生产环境） |

#### `auth` 可选值

| 值 | 说明 |
|------|------|
| `mock` | Mock JWT 认证（开发/测试用） |
| `cognito` | AWS Cognito 认证（生产环境） |
| `tokens-only` | 仅支持 Delegate Token，无 JWT 验证 |

#### `database` 可选值

| 值 | 说明 |
|------|------|
| `local` | 本地 DynamoDB Local |
| `aws` | AWS DynamoDB |

#### `limits` 字段

| 字段 | 类型 | 单位 | 默认值 | 说明 |
|------|------|------|--------|------|
| `maxNodeSize` | number | bytes | 4194304 (4MB) | 单个节点/块的最大大小 |
| `maxNameBytes` | number | bytes | 255 | 名称的最大字节数 |
| `maxCollectionChildren` | number | count | 10000 | 集合节点的最大子节点数 |
| `maxPayloadSize` | number | bytes | 10485760 (10MB) | 单次上传的最大负载大小 |
| `maxDelegateTokenTtl` | number | seconds | 2592000 (30天) | Delegate 的最大有效期 |
| `maxAccessTokenTtl` | number | seconds | 86400 (1天) | Access Token 的最大有效期 |
| `maxTokenDepth` | number | count | 15 | Delegate 转签发链的最大深度 |

#### `features` 字段

| 字段 | 类型 | 环境变量 | 默认值 | 说明 |
|------|------|----------|--------|------|
| `jwtAuth` | boolean | `FEATURE_JWT_AUTH` | true | 是否启用 JWT Bearer Token 认证 |
| `oauthLogin` | boolean | `FEATURE_OAUTH_LOGIN` | true | 是否启用 OAuth 登录流程 |

### 使用场景

1. **客户端初始化**: 在连接服务前查询限制参数，避免上传超过限制的数据
2. **环境检测**: 检查当前连接的是开发环境还是生产环境
3. **功能降级**: 根据 `features` 字段决定启用哪些功能
4. **Token 配置**: 获取 Token TTL 限制，合理设置 Token 有效期
