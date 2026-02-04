# @casfa/auth

AWP 认证中间件，基于 **ECDSA P-256 密钥对** 实现 Client 授权认证。

## 概述

`@casfa/auth` 提供 AWP 的服务端认证机制：

- **ECDSA P-256 密钥对** - 客户端生成密钥对，服务端验证签名
- **服务端验证码** - 防钓鱼保护，验证码由服务端生成
- **请求签名** - 每个请求都使用私钥签名
- **401 Challenge** - 未认证请求返回标准挑战响应

## 安装

```bash
bun add @casfa/auth
```

## 快速开始

```typescript
import {
  createAwpAuthMiddleware,
  routeAuthRequest,
  MemoryPendingAuthStore,
  MemoryPubkeyStore,
} from "@casfa/auth";

// 创建存储 (生产环境使用 DynamoDB/Redis)
const pendingAuthStore = new MemoryPendingAuthStore();
const pubkeyStore = new MemoryPubkeyStore();

// 创建认证中间件
const authMiddleware = createAwpAuthMiddleware({
  pendingAuthStore,
  pubkeyStore,
});

// 在请求处理中使用
Bun.serve({
  port: 3000,
  fetch: async (req) => {
    const authReq = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      text: () => req.clone().text(),
      clone: () => authReq,
    };

    // 处理认证端点 (/auth/init, /auth/status)
    const authResponse = await routeAuthRequest(authReq, {
      baseUrl: "http://localhost:3000",
      pendingAuthStore,
      pubkeyStore,
    });
    if (authResponse) return authResponse;

    // 验证请求签名
    const result = await authMiddleware(authReq);
    if (!result.authorized) {
      return result.challengeResponse!;
    }

    // 继续处理业务逻辑
    // result.context 包含 { userId, pubkey, clientName }
    return handleRequest(req, result.context);
  },
});
```

## 认证流程

```
1. Client 发起请求 (无认证)
   → Server 返回 401 + auth_init_endpoint

2. Client 生成密钥对，调用 POST /auth/init
   { pubkey, client_name }
   → Server 生成验证码，返回 { auth_url, verification_code, expires_in }

3. Client 显示验证码给用户

4. 用户访问 auth_url，登录后输入验证码

5. Server 验证码匹配，存储 pubkey → userId 映射

6. Client 轮询 /auth/status，获取授权状态

7. 后续请求携带签名
   X-AWP-Pubkey, X-AWP-Timestamp, X-AWP-Signature
```

## 请求签名

每个认证请求需要携带以下 HTTP 头：

| 头名称 | 说明 |
|--------|------|
| `X-AWP-Pubkey` | 公钥 (格式: `x.y`, base64url 编码) |
| `X-AWP-Timestamp` | Unix 时间戳 (秒) |
| `X-AWP-Signature` | 签名 (base64url 编码) |

**签名算法**：

```typescript
payload = `${timestamp}.${METHOD}.${path}.${sha256(body)}`
signature = ECDSA-P256-SHA256(privateKey, payload)
```

## 401 Challenge Response

未认证请求返回：

```json
{
  "error": "unauthorized",
  "error_description": "Authentication required",
  "auth_init_endpoint": "/auth/init"
}
```

HTTP 头：

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: AWP realm="awp"
Content-Type: application/json
```

## Auth Init 端点

**请求**：

```
POST /auth/init
Content-Type: application/json

{
  "pubkey": "abc123...xyz.def456...uvw",
  "client_name": "My AI Agent"
}
```

**响应**：

```json
{
  "auth_url": "https://example.com/auth?pubkey=abc123...",
  "verification_code": "ABC-123",
  "expires_in": 600,
  "poll_interval": 5
}
```

## 配置选项

```typescript
interface AwpAuthConfig {
  // 必需
  pendingAuthStore: PendingAuthStore;  // 待授权存储
  pubkeyStore: PubkeyStore;            // 已授权公钥存储

  // 可选
  authInitPath?: string;        // 默认: "/auth/init"
  authStatusPath?: string;      // 默认: "/auth/status"
  authPagePath?: string;        // 默认: "/auth"
  verificationCodeTTL?: number; // 默认: 600 (10分钟)
  maxClockSkew?: number;        // 默认: 300 (5分钟)
  excludePaths?: string[];      // 排除认证的路径
}
```

## 存储接口

### PendingAuthStore

存储待授权请求：

```typescript
interface PendingAuthStore {
  create(auth: PendingAuth): Promise<void>;
  get(pubkey: string): Promise<PendingAuth | null>;
  delete(pubkey: string): Promise<void>;
  validateCode(pubkey: string, code: string): Promise<boolean>;
}
```

### PubkeyStore

存储已授权公钥：

```typescript
interface PubkeyStore {
  lookup(pubkey: string): Promise<AuthorizedPubkey | null>;
  store(auth: AuthorizedPubkey): Promise<void>;
  revoke(pubkey: string): Promise<void>;
  listByUser?(userId: string): Promise<AuthorizedPubkey[]>;
}
```

### 内置实现

- `MemoryPendingAuthStore` - 内存存储 (仅用于开发/测试)
- `MemoryPubkeyStore` - 内存存储 (仅用于开发/测试)

生产环境请使用 `@casfa/aws-lambda` 中的 DynamoDB 实现。

## 授权完成处理

当用户在授权页面输入验证码后，调用 `completeAuthorization`：

```typescript
import { completeAuthorization } from "@casfa/auth";

// 在授权页面的 POST 处理中
async function handleAuthPageSubmit(req: Request, userId: string) {
  const { pubkey, verification_code } = await req.json();

  const result = await completeAuthorization(pubkey, verification_code, userId, {
    pendingAuthStore,
    pubkeyStore,
    authorizationTTL: 30 * 24 * 60 * 60, // 30天
  });

  if (result.success) {
    return new Response(JSON.stringify({ success: true }));
  } else {
    return new Response(JSON.stringify({ error: result.error }), { status: 400 });
  }
}
```

## 排除路径

以下路径默认不需要认证：

- `/auth/init` - 认证初始化
- `/auth/status` - 认证状态轮询
- `/auth/` - 认证页面
- `/health`, `/healthz`, `/ping` - 健康检查

可通过 `excludePaths` 配置添加更多路径。

## 测试

E2E 测试覆盖以下场景：

1. **Auth Init 测试**：验证码生成和返回
2. **Auth Complete 测试**：验证码验证和授权完成
3. **签名验证测试**：有效/无效签名处理
4. **时间戳验证**：过期时间戳拒绝
5. **路径排除测试**：认证端点和健康检查不需要认证

## API 导出

### 中间件

- `createAwpAuthMiddleware(config)` - 创建认证中间件
- `routeAuthRequest(request, options)` - 路由认证端点请求
- `hasAwpAuthCredentials(request)` - 检查请求是否包含认证凭据

### Auth Init

- `handleAuthInit(request, options)` - 处理 /auth/init 请求
- `handleAuthStatus(request, options)` - 处理 /auth/status 请求
- `generateVerificationCode()` - 生成验证码
- `MemoryPendingAuthStore` - 内存待授权存储

### Auth Complete

- `completeAuthorization(pubkey, code, userId, options)` - 完成授权
- `handleAuthComplete(request, userId, options)` - 处理授权完成请求
- `MemoryPubkeyStore` - 内存公钥存储

### 低级工具

- `verifyAwpAuth(request, pubkeyStore, maxClockSkew)` - 验证请求签名
- `verifySignature(pubkey, payload, signature)` - 验证 ECDSA 签名
- `validateTimestamp(timestamp, maxClockSkew)` - 验证时间戳
- `buildChallengeResponse(authInitEndpoint)` - 构建 401 响应

### 类型

- `AwpAuthConfig` - 认证配置
- `PendingAuth`, `PendingAuthStore` - 待授权相关
- `AuthorizedPubkey`, `PubkeyStore` - 已授权相关
- `AuthContext`, `AuthResult` - 认证结果
- `AuthHttpRequest` - HTTP 请求接口
- `AuthInitRequest`, `AuthInitResponse` - 初始化请求/响应
- `AuthCompleteRequest`, `AuthStatusResponse` - 完成/状态请求/响应
- `ChallengeBody` - 401 响应体
- `AWP_AUTH_DEFAULTS`, `AWP_AUTH_HEADERS` - 常量

## License

MIT
