# Middleware 中间件重构规划

> 版本: 1.0  
> 日期: 2026-02-05  
> 基于: [04-access-control.md](../04-access-control.md), [01-delegate-token.md](../01-delegate-token.md)

---

## 目录

1. [概述](#1-概述)
2. [中间件变更总览](#2-中间件变更总览)
3. [新增中间件](#3-新增中间件)
4. [修改中间件](#4-修改中间件)
5. [废弃中间件](#5-废弃中间件)
6. [认证上下文重构](#6-认证上下文重构)
7. [实现细节](#7-实现细节)
8. [实现步骤](#8-实现步骤)

---

## 1. 概述

### 1.1 重构背景

当前中间件架构支持多种认证方式：

```
createAuthMiddleware
├── Bearer JWT (User)
├── Bearer Token (Agent/Ticket)
├── Agent Token ("Agent xxx")
├── Ticket Token ("Ticket xxx")
└── AWP Signed Request (P256)
```

重构后简化为三种认证方式：

```
├── jwtAuthMiddleware         # User JWT 认证
├── delegateTokenMiddleware   # Delegate Token 认证
└── accessTokenMiddleware     # Access Token 认证
```

### 1.2 变更范围

| 类型 | 数量 | 说明 |
|------|------|------|
| **新增中间件** | 5 | Token 认证、scope 验证、权限检查 |
| **修改中间件** | 2 | realm 访问、admin 访问 |
| **废弃中间件** | 3 | 旧的统一认证、ticket 认证 |

### 1.3 Rate Limiting 说明

> **注意**：Rate Limiting 不在代码层面实现。
> 
> 由于服务运行在 AWS Lambda 上，Rate Limiting 应在 **API Gateway / CloudFormation** 层面配置：
> - Lambda 是无状态的，代码层面实现 rate limiting 需要外部状态存储（Redis/DynamoDB），增加复杂度和延迟
> - API Gateway 内置 throttling 和 usage plans，配置简单且高效
> - 这是 AWS 推荐的最佳实践
>
> 具体配置请参考 CloudFormation 模板中的 `AWS::ApiGateway::UsagePlan` 资源。

### 1.4 文件结构

```
apps/server/backend/src/middleware/
├── index.ts                    # 导出（修改）
├── jwt-auth.ts                 # 新增：JWT 认证
├── delegate-token-auth.ts      # 新增：Delegate Token 认证
├── access-token-auth.ts        # 新增：Access Token 认证
├── scope-validation.ts         # 新增：Scope 验证
├── permission-check.ts         # 新增：权限检查
├── realm-access.ts             # 修改：Realm 访问控制
├── deprecated/                 # 废弃
│   ├── auth.ts                 # 旧的统一认证
│   └── ticket-auth.ts          # Ticket 认证
```

---

## 2. 中间件变更总览

### 2.1 认证中间件对比

| 旧中间件 | 新中间件 | 说明 |
|----------|----------|------|
| `createAuthMiddleware` | 拆分 | 拆分为多个专用中间件 |
| - | `createJwtAuthMiddleware` | 仅处理 User JWT |
| - | `createDelegateTokenMiddleware` | Delegate Token（128 字节） |
| - | `createAccessTokenMiddleware` | Access Token（128 字节） |
| `createTicketAuthMiddleware` | 废弃 | 由 accessTokenMiddleware 替代 |

### 2.2 授权中间件对比

| 旧中间件 | 新中间件 | 说明 |
|----------|----------|------|
| `createWriteAccessMiddleware` | 拆分 | 拆分为更细粒度的权限检查 |
| - | `createCanUploadMiddleware` | 检查 canUpload 标志 |
| - | `createCanManageDepotMiddleware` | 检查 canManageDepot 标志 |
| - | `createScopeValidationMiddleware` | 验证节点在 scope 内 |
| `createRealmAccessMiddleware` | 修改 | 验证 realm 匹配 |
| `createAdminAccessMiddleware` | 保持 | 验证 admin 角色 |

---

## 3. 新增中间件

### 3.1 JWT 认证中间件

**文件**: `middleware/jwt-auth.ts`

```typescript
/**
 * JWT Authentication Middleware
 *
 * 仅验证 User JWT，用于 Token 管理和用户操作。
 */

import type { MiddlewareHandler } from "hono";
import type { Env, JwtAuthContext } from "../types";
import type { JwtVerifier } from "./types";
import type { UserRolesDb } from "../db/user-roles";

export type JwtAuthMiddlewareDeps = {
  jwtVerifier: JwtVerifier;
  userRolesDb: UserRolesDb;
};

export const createJwtAuthMiddleware = (
  deps: JwtAuthMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { jwtVerifier, userRolesDb } = deps;

  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid Authorization header" }, 401);
    }

    const token = parts[1];

    // JWT 验证
    try {
      const result = await jwtVerifier(token);
      if (!result) {
        return c.json({ error: "UNAUTHORIZED", message: "Invalid JWT" }, 401);
      }

      const { userId, exp, email, name } = result;

      // 获取用户角色
      const role = await userRolesDb.getRole(userId);
      
      // 检查是否被禁用
      if (role === "unauthorized") {
        return c.json({ error: "FORBIDDEN", message: "User is unauthorized" }, 403);
      }

      const auth: JwtAuthContext = {
        type: "jwt",
        userId,
        realm: `usr_${userId}`,
        email,
        name,
        role,
        expiresAt: exp ? exp * 1000 : Date.now() + 3600000,
      };

      c.set("auth", auth);
      return next();
    } catch {
      return c.json({ error: "UNAUTHORIZED", message: "JWT verification failed" }, 401);
    }
  };
};
```

### 3.2 公共 Token 验证逻辑

**文件**: `middleware/token-auth-common.ts`

为避免 Delegate Token 和 Access Token 中间件的代码重复，抽取公共验证逻辑：

```typescript
/**
 * Common Token Authentication Logic
 *
 * 抽取 Delegate Token 和 Access Token 的公共验证逻辑。
 */

import type { Context } from "hono";
import type { Env } from "../types";
import type { DelegateTokensDb } from "../db/delegate-tokens";
import type { DelegateTokenRecord } from "../types/delegate-token";
import { decodeToken, computeTokenId } from "../util/token";

export type TokenValidationResult = 
  | { success: true; tokenId: string; tokenBytes: Uint8Array; tokenRecord: DelegateTokenRecord; decoded: DecodedDelegateToken }
  | { success: false; error: string; message: string; status: 401 | 403 };

/**
 * 从请求头提取并验证 Token
 */
export async function validateToken(
  c: Context<Env>,
  delegateTokensDb: DelegateTokensDb
): Promise<TokenValidationResult> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return { success: false, error: "UNAUTHORIZED", message: "Missing Authorization header", status: 401 };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return { success: false, error: "UNAUTHORIZED", message: "Invalid Authorization header", status: 401 };
  }

  const tokenBase64 = parts[1];

  // 解码 Token
  let tokenBytes: Uint8Array;
  try {
    tokenBytes = Buffer.from(tokenBase64, "base64");
    if (tokenBytes.length !== 128) {
      return { success: false, error: "INVALID_TOKEN_FORMAT", message: "Token must be 128 bytes", status: 401 };
    }
  } catch {
    return { success: false, error: "INVALID_TOKEN_FORMAT", message: "Invalid Base64 encoding", status: 401 };
  }

  // 计算 Token ID 并查找
  const tokenId = computeTokenId(tokenBytes);
  const tokenRecord = await delegateTokensDb.getValid(tokenId);

  if (!tokenRecord) {
    return { success: false, error: "TOKEN_NOT_FOUND", message: "Token not found", status: 401 };
  }

  // 检查是否已撤销
  if (tokenRecord.isRevoked) {
    return { success: false, error: "TOKEN_REVOKED", message: "Token has been revoked", status: 401 };
  }

  // 检查是否过期
  if (tokenRecord.expiresAt < Date.now()) {
    return { success: false, error: "TOKEN_EXPIRED", message: "Token has expired", status: 401 };
  }

  // 注意：由于使用级联撤销策略，祖先撤销时会同时撤销所有子 Token，
  // 因此不需要在每次认证时检查 issuerChain 中的祖先状态。
  // 上面的 isRevoked 检查已经足够。

  // 解码 Token 内容
  const decoded = decodeToken(tokenBytes);

  return { success: true, tokenId, tokenBytes, tokenRecord, decoded };
}
```

### 3.3 Delegate Token 认证中间件

**文件**: `middleware/delegate-token-auth.ts`

```typescript
/**
 * Delegate Token Authentication Middleware
 *
 * 验证 Delegate Token（再授权 Token），用于 Token 转签发和 Ticket 创建。
 * Delegate Token 可以转签发但不能直接访问数据。
 */

import type { MiddlewareHandler } from "hono";
import type { Env, DelegateTokenAuthContext } from "../types";
import type { DelegateTokensDb } from "../db/delegate-tokens";
import { validateToken } from "./token-auth-common";

export type DelegateTokenMiddlewareDeps = {
  delegateTokensDb: DelegateTokensDb;
};

export const createDelegateTokenMiddleware = (
  deps: DelegateTokenMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { delegateTokensDb } = deps;

  return async (c, next) => {
    // 使用公共验证逻辑
    const result = await validateToken(c, delegateTokensDb);
    
    if (!result.success) {
      return c.json({ error: result.error, message: result.message }, result.status);
    }

    const { tokenId, tokenBytes, tokenRecord, decoded } = result;

    // 检查 Token 类型
    if (tokenRecord.tokenType !== "delegate") {
      return c.json({ 
        error: "DELEGATE_TOKEN_REQUIRED", 
        message: "This endpoint requires a Delegate Token, not Access Token" 
      }, 403);
    }

    const auth: DelegateTokenAuthContext = {
      type: "delegate",
      tokenId,
      tokenBytes,
      tokenRecord,
      realm: tokenRecord.realm,
      canUpload: tokenRecord.canUpload,
      canManageDepot: tokenRecord.canManageDepot,
      depth: tokenRecord.depth,
      issuerChain: tokenRecord.issuerChain,
      decoded,
    };

    c.set("auth", auth);
    return next();
  };
};
```

### 3.4 Access Token 认证中间件

**文件**: `middleware/access-token-auth.ts`

```typescript
/**
 * Access Token Authentication Middleware
 *
 * 验证 Access Token（访问 Token），用于数据访问操作。
 * Access Token 可以访问数据但不能转签发。
 */

import type { MiddlewareHandler } from "hono";
import type { Env, AccessTokenAuthContext } from "../types";
import type { DelegateTokensDb } from "../db/delegate-tokens";
import { validateToken } from "./token-auth-common";

export type AccessTokenMiddlewareDeps = {
  delegateTokensDb: DelegateTokensDb;
};

export const createAccessTokenMiddleware = (
  deps: AccessTokenMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { delegateTokensDb } = deps;

  return async (c, next) => {
    // 使用公共验证逻辑
    const result = await validateToken(c, delegateTokensDb);
    
    if (!result.success) {
      return c.json({ error: result.error, message: result.message }, result.status);
    }

    const { tokenId, tokenBytes, tokenRecord, decoded } = result;

    // 检查 Token 类型
    if (tokenRecord.tokenType !== "access") {
      return c.json({ 
        error: "ACCESS_TOKEN_REQUIRED", 
        message: "This endpoint requires an Access Token, not Delegate Token" 
      }, 403);
    }

    const auth: AccessTokenAuthContext = {
      type: "access",
      tokenId,
      tokenBytes,
      tokenRecord,
      realm: tokenRecord.realm,
      canUpload: tokenRecord.canUpload,
      canManageDepot: tokenRecord.canManageDepot,
      issuerChain: tokenRecord.issuerChain,
      decoded,
    };

    c.set("auth", auth);
    return next();
  };
};
```

### 3.5 Scope 验证中间件

**文件**: `middleware/scope-validation.ts`

```typescript
/**
 * Scope Validation Middleware
 *
 * 验证请求的节点在 Token 的 scope 范围内。
 * 需要 X-CAS-Index-Path Header 提供证明。
 */

import type { MiddlewareHandler } from "hono";
import type { Env, AccessTokenAuthContext } from "../types";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes";
import { verifyIndexPath } from "../util/scope";

export type ScopeValidationMiddlewareDeps = {
  scopeSetNodesDb: ScopeSetNodesDb;
};

export const createScopeValidationMiddleware = (
  deps: ScopeValidationMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { scopeSetNodesDb } = deps;

  return async (c, next) => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    if (!auth || auth.type !== "access") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Access token required" }, 403);
    }

    // 获取请求的节点 key
    const nodeKey = c.req.param("key");
    if (!nodeKey) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing node key" }, 400);
    }

    // 获取 Index Path Header
    const indexPath = c.req.header("X-CAS-Index-Path");
    if (!indexPath) {
      return c.json({ 
        error: "INDEX_PATH_REQUIRED", 
        message: "X-CAS-Index-Path header is required for node access" 
      }, 400);
    }

    // 获取 Token 的 scope
    let scopeRoots: string[];
    if (auth.tokenRecord.scopeNodeHash) {
      // 单 scope
      scopeRoots = [auth.tokenRecord.scopeNodeHash];
    } else if (auth.tokenRecord.scopeSetNodeId) {
      // 多 scope 或 empty set
      const setNode = await scopeSetNodesDb.get(auth.tokenRecord.scopeSetNodeId);
      if (!setNode) {
        return c.json({ error: "INTERNAL_ERROR", message: "Scope set node not found" }, 500);
      }
      scopeRoots = setNode.children;
    } else {
      // 不应该发生
      return c.json({ error: "INTERNAL_ERROR", message: "Token has no scope" }, 500);
    }

    // 验证 index path
    const verification = await verifyIndexPath(nodeKey, indexPath, scopeRoots);
    if (!verification.valid) {
      return c.json({ 
        error: "NODE_NOT_IN_SCOPE", 
        message: "The requested node is not within the authorized scope",
        details: {
          nodeKey,
          indexPath,
          reason: verification.reason
        }
      }, 403);
    }

    // 将验证结果存入上下文供后续使用
    c.set("scopeVerification", verification);

    return next();
  };
};
```

### 3.6 权限检查中间件

**文件**: `middleware/permission-check.ts`

```typescript
/**
 * Permission Check Middleware
 *
 * 检查 Token 是否具有特定权限标志。
 */

import type { MiddlewareHandler } from "hono";
import type { Env, TokenAuthContext } from "../types";

/**
 * 检查 canUpload 权限
 */
export const createCanUploadMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth") as TokenAuthContext;
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    if (!auth.canUpload) {
      return c.json({ 
        error: "UPLOAD_NOT_ALLOWED", 
        message: "Token does not have upload permission" 
      }, 403);
    }

    return next();
  };
};

/**
 * 检查 canManageDepot 权限
 */
export const createCanManageDepotMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth") as TokenAuthContext;
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    if (!auth.canManageDepot) {
      return c.json({ 
        error: "DEPOT_MANAGE_NOT_ALLOWED", 
        message: "Token does not have depot management permission" 
      }, 403);
    }

    return next();
  };
};
```

---

## 4. 修改中间件

### 4.1 Realm 访问中间件

**文件**: `middleware/realm-access.ts`

```typescript
/**
 * Realm Access Middleware
 *
 * 验证 Token 的 realm 与请求的 realmId 匹配。
 */

import type { MiddlewareHandler } from "hono";
import type { Env, TokenAuthContext, JwtAuthContext } from "../types";

export const createRealmAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth") as TokenAuthContext | JwtAuthContext;
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    const realmId = c.req.param("realmId");
    if (!realmId) {
      return c.json({ error: "INVALID_REQUEST", message: "Missing realmId" }, 400);
    }

    // 检查 realm 匹配
    if (auth.realm !== realmId) {
      return c.json({ 
        error: "REALM_MISMATCH", 
        message: "Token realm does not match the requested realmId" 
      }, 403);
    }

    return next();
  };
};
```

### 4.2 Admin 访问中间件

**文件**: `middleware/realm-access.ts`（保持位置）

```typescript
/**
 * Admin Access Middleware
 *
 * 验证用户具有 admin 角色。
 */

export const createAdminAccessMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const auth = c.get("auth") as JwtAuthContext;
    if (!auth) {
      return c.json({ error: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }

    // 只有 JWT 认证的用户可以访问 admin 功能
    if (auth.type !== "jwt") {
      return c.json({ error: "FORBIDDEN", message: "Admin access requires user authentication" }, 403);
    }

    if (auth.role !== "admin") {
      return c.json({ error: "FORBIDDEN", message: "Admin access required" }, 403);
    }

    return next();
  };
};
```

---

## 5. 废弃中间件

### 5.1 废弃文件清单

| 文件 | 说明 | 处理方式 |
|------|------|----------|
| `auth.ts` | 旧的统一认证中间件 | 移至 `deprecated/` |
| `ticket-auth.ts` | Ticket 认证中间件 | 移至 `deprecated/` |

### 5.2 废弃函数清单

**`auth.ts` 中废弃的函数**：

```typescript
// 废弃：统一认证中间件（支持 JWT/Agent/Ticket/AWP）
export const createAuthMiddleware = (deps: AuthMiddlewareDeps) => {...}

// 废弃：可选认证中间件
export const createOptionalAuthMiddleware = (deps: AuthMiddlewareDeps) => {...}

// 废弃的辅助函数
const authenticateBearer = async (authHeader: string) => {...}
const authenticateAwp = async (...) => {...}
```

**`ticket-auth.ts` 中废弃的函数**：

```typescript
// 废弃：Ticket 认证
export const createTicketAuthMiddleware = (deps: TicketAuthDeps) => {...}
export const checkTicketReadAccess = (...) => {...}
export const checkTicketWriteQuota = (...) => {...}
```

### 5.3 迁移映射

| 旧用法 | 新用法 |
|--------|--------|
| `authMiddleware` (JWT) | `jwtAuthMiddleware` |
| `authMiddleware` (Agent) | `delegateTokenMiddleware` |
| `authMiddleware` (Ticket) | `accessTokenMiddleware` |
| `ticketAuthMiddleware` | `accessTokenMiddleware` + `scopeValidationMiddleware` |
| `writeAccessMiddleware` | `canUploadMiddleware` 或 `canManageDepotMiddleware` |

---

## 6. 认证上下文重构

### 6.1 新的 AuthContext 类型

**文件**: `types.ts`

```typescript
/**
 * 认证上下文基础类型
 */
type BaseAuthContext = {
  realm: string;
};

/**
 * JWT 认证上下文（用户登录）
 */
export type JwtAuthContext = BaseAuthContext & {
  type: "jwt";
  userId: string;
  email?: string;
  name?: string;
  role: "authorized" | "admin" | "unauthorized";
  expiresAt: number;
};

/**
 * Delegate Token 认证上下文（再授权 Token）
 */
export type DelegateTokenAuthContext = BaseAuthContext & {
  type: "delegate";
  tokenId: string;
  tokenBytes: Uint8Array;
  tokenRecord: DelegateTokenRecord;
  canUpload: boolean;
  canManageDepot: boolean;
  depth: number;
  issuerChain: string[];
  decoded: DecodedDelegateToken;
};

/**
 * Access Token 认证上下文（访问 Token）
 */
export type AccessTokenAuthContext = BaseAuthContext & {
  type: "access";
  tokenId: string;
  tokenBytes: Uint8Array;
  tokenRecord: DelegateTokenRecord;
  canUpload: boolean;
  canManageDepot: boolean;
  issuerChain: string[];
  decoded: DecodedDelegateToken;
};

/**
 * Token 认证上下文联合类型
 */
export type TokenAuthContext = DelegateTokenAuthContext | AccessTokenAuthContext;

/**
 * 所有认证上下文联合类型
 */
export type AuthContext = JwtAuthContext | TokenAuthContext;

/**
 * Hono 环境类型
 */
export type Env = {
  Variables: {
    auth: AuthContext;
    scopeVerification?: ScopeVerificationResult;
  };
};
```

### 6.2 废弃的类型

```typescript
// 废弃：旧的 AuthContext
type AuthContext = {
  token: Token;           // 废弃：改用 tokenRecord
  userId?: string;        // 废弃：JWT 中使用
  realm: string;
  canRead: boolean;       // 废弃：Access Token 隐含可读
  canWrite: boolean;      // 废弃：改用 canUpload
  canIssueTicket: boolean; // 废弃：改用 type === "delegate"
  canManageUsers?: boolean; // 废弃：改用 role === "admin"
  allowedScope?: string[]; // 废弃：改用 tokenRecord.scope*
  identityType: "user" | "agent" | "ticket" | "awp"; // 废弃：改用 type
  issuerId: string;       // 废弃：改用 tokenId
  isAgent: boolean;       // 废弃
  role?: UserRole;
  email?: string;
  name?: string;
};
```

### 6.3 类型守卫函数

```typescript
/**
 * 类型守卫：检查是否为 JWT 认证
 */
export function isJwtAuth(auth: AuthContext): auth is JwtAuthContext {
  return auth.type === "jwt";
}

/**
 * 类型守卫：检查是否为 Delegate Token 认证
 */
export function isDelegateTokenAuth(auth: AuthContext): auth is DelegateTokenAuthContext {
  return auth.type === "delegate";
}

/**
 * 类型守卫：检查是否为 Access Token 认证
 */
export function isAccessTokenAuth(auth: AuthContext): auth is AccessTokenAuthContext {
  return auth.type === "access";
}

/**
 * 类型守卫：检查是否为 Token 认证（Delegate 或 Access）
 */
export function isTokenAuth(auth: AuthContext): auth is TokenAuthContext {
  return auth.type === "delegate" || auth.type === "access";
}
```

---

## 7. 实现细节

### 7.1 Token 解码工具函数

**文件**: `util/token.ts`

```typescript
import { blake3 } from "@noble/hashes/blake3";
import { crockfordBase32Encode } from "./encoding";

/**
 * 计算 Token ID
 * Token ID = "dlt1_" + Crockford Base32(Blake3-128(tokenBytes))
 */
export function computeTokenId(tokenBytes: Uint8Array): string {
  const hash = blake3(tokenBytes, { dkLen: 16 }); // 128 bits
  return `dlt1_${crockfordBase32Encode(hash)}`;
}

/**
 * 解码 Token 二进制格式
 */
export function decodeToken(tokenBytes: Uint8Array): DecodedDelegateToken {
  if (tokenBytes.length !== 128) {
    throw new Error("Token must be 128 bytes");
  }

  // Magic number check
  const magic = new DataView(tokenBytes.buffer, tokenBytes.byteOffset, 4).getUint32(0, false);
  if (magic !== 0x01544C44) { // "DLT\x01"
    throw new Error("Invalid token magic number");
  }

  // Parse flags (byte 4)
  const flagsByte = tokenBytes[4];
  const flags: DelegateTokenFlags = {
    isDelegate: (flagsByte & 0x01) !== 0,
    isUserIssued: (flagsByte & 0x02) !== 0,
    canUpload: (flagsByte & 0x04) !== 0,
    canManageDepot: (flagsByte & 0x08) !== 0,
    depth: (flagsByte >> 4) & 0x0F,
  };

  // Parse TTL (bytes 8-15, big-endian uint64)
  const ttlView = new DataView(tokenBytes.buffer, tokenBytes.byteOffset + 8, 8);
  const ttl = Number(ttlView.getBigUint64(0, false));

  // Parse quota (bytes 16-23, big-endian uint64)
  const quotaView = new DataView(tokenBytes.buffer, tokenBytes.byteOffset + 16, 8);
  const quota = Number(quotaView.getBigUint64(0, false));

  // Extract fixed-size fields
  const salt = tokenBytes.slice(24, 32);       // 8 bytes
  const issuer = tokenBytes.slice(32, 64);     // 32 bytes
  const realm = tokenBytes.slice(64, 96);      // 32 bytes
  const scope = tokenBytes.slice(96, 128);     // 32 bytes

  return { flags, ttl, quota, salt, issuer, realm, scope };
}
```

### 7.2 Scope 验证工具函数

**文件**: `util/scope.ts`

```typescript
import type { StorageService } from "../services/storage";
import { blake3 } from "@noble/hashes/blake3";

/**
 * Scope 验证结果
 */
export type ScopeVerificationResult = {
  valid: boolean;
  reason?: string;
  verifiedPath?: number[];
};

/**
 * 验证 index path 是否有效
 * 
 * Index path 格式: "rootIndex:childIndex1:childIndex2:..."
 * - 第一个数字是 scope 根列表的索引
 * - 后续数字是 index 节点中 children 数组的索引
 * 
 * @param nodeKey - 请求的节点 key (hash)
 * @param indexPath - 客户端提供的 index path (如 "0:1:2")
 * @param scopeRoots - Token scope 的根节点列表
 * @param storageService - 存储服务，用于获取 index 节点
 */
export async function verifyIndexPath(
  nodeKey: string,
  indexPath: string,
  scopeRoots: string[],
  storageService: StorageService
): Promise<ScopeVerificationResult> {
  // 解析 index path
  const indices = indexPath.split(":").map(s => parseInt(s, 10));
  if (indices.some(isNaN)) {
    return { valid: false, reason: "Invalid index path format" };
  }

  if (indices.length === 0) {
    return { valid: false, reason: "Empty index path" };
  }

  // 第一个索引指向 scope 根列表
  const rootIndex = indices[0];
  if (rootIndex < 0 || rootIndex >= scopeRoots.length) {
    return { valid: false, reason: "Root index out of bounds" };
  }

  let currentHash = scopeRoots[rootIndex];

  // 如果只有一个索引，直接检查根节点是否匹配目标
  if (indices.length === 1) {
    if (currentHash !== nodeKey) {
      return { valid: false, reason: "Path does not lead to requested node" };
    }
    return { valid: true, verifiedPath: indices };
  }

  // 从根开始遍历 index path
  for (let i = 1; i < indices.length; i++) {
    const childIndex = indices[i];

    // 获取当前节点
    const nodeData = await storageService.getNode(currentHash);
    if (!nodeData) {
      return { valid: false, reason: `Node not found: ${currentHash}` };
    }

    // 解析节点，获取子节点列表
    const parsed = parseIndexNode(nodeData);
    if (!parsed) {
      return { valid: false, reason: `Invalid index node format: ${currentHash}` };
    }

    // 检查子节点索引是否在范围内
    if (childIndex < 0 || childIndex >= parsed.children.length) {
      return { valid: false, reason: `Child index ${childIndex} out of bounds (max: ${parsed.children.length - 1})` };
    }

    // 移动到子节点
    currentHash = parsed.children[childIndex];
  }

  // 验证最终节点是否匹配目标
  if (currentHash !== nodeKey) {
    return { valid: false, reason: "Path does not lead to requested node" };
  }

  return { valid: true, verifiedPath: indices };
}

/**
 * 解析 Index 节点格式
 * 
 * Index 节点是 JSON 格式：
 * { "type": "index", "children": ["hash1", "hash2", ...] }
 */
function parseIndexNode(data: Uint8Array): { children: string[] } | null {
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);
    
    if (parsed.type !== "index" || !Array.isArray(parsed.children)) {
      return null;
    }
    
    // 验证所有 children 都是字符串
    if (!parsed.children.every((c: unknown) => typeof c === "string")) {
      return null;
    }
    
    return { children: parsed.children };
  } catch {
    return null;
  }
}

/**
 * 验证 scope 是相对于父 scope 的子集
 * 
 * @param requestedScope - 请求的 scope（相对 index path）
 * @param parentScopeRoots - 父 Token 的 scope 根节点列表
 */
export async function validateRelativeScope(
  requestedScope: string[],
  parentScopeRoots: string[],
  storageService: StorageService
): Promise<{ valid: boolean; resolvedRoots?: string[]; error?: string }> {
  const resolvedRoots: string[] = [];

  for (const scopePath of requestedScope) {
    // "." 表示继承父 scope 的对应项
    if (scopePath === ".") {
      resolvedRoots.push(...parentScopeRoots);
      continue;
    }

    // 解析相对路径 "rootIndex:childIndex1:childIndex2"
    const verification = await verifyIndexPath(
      "", // 空目标，我们只是要获取最终节点
      scopePath,
      parentScopeRoots,
      storageService
    );

    if (!verification.valid) {
      return { valid: false, error: `Invalid scope path: ${scopePath} - ${verification.reason}` };
    }

    // 从 verification 获取最终到达的节点
    // 需要重新遍历以获取最终节点 hash
    const indices = scopePath.split(":").map(s => parseInt(s, 10));
    let currentHash = parentScopeRoots[indices[0]];
    
    for (let i = 1; i < indices.length; i++) {
      const nodeData = await storageService.getNode(currentHash);
      const parsed = parseIndexNode(nodeData!);
      currentHash = parsed!.children[indices[i]];
    }

    resolvedRoots.push(currentHash);
  }

  return { valid: true, resolvedRoots };
}
```

### 7.3 IssuerChain 祖先检查

**文件**: `db/delegate-tokens.ts` 中的方法

```typescript
/**
 * 检查 issuerChain 中的所有祖先 Token 是否有效
 * 
 * @param issuerChain - Token 的签发链
 * @returns 验证结果，包含是否有效和可能的已撤销祖先 ID
 */
async checkAncestorsValid(
  issuerChain: string[]
): Promise<{ valid: boolean; revokedAncestorId?: string }> {
  // 过滤出 Token ID（以 dlt1_ 开头）
  const tokenIds = issuerChain.filter(id => id.startsWith("dlt1_"));
  
  if (tokenIds.length === 0) {
    return { valid: true };
  }

  // 批量获取祖先 Token
  const ancestors = await this.batchGet(tokenIds);
  
  for (const ancestor of ancestors) {
    if (ancestor.isRevoked) {
      return { valid: false, revokedAncestorId: ancestor.tokenId };
    }
  }

  return { valid: true };
}
```

---

## 8. 实现步骤

### 8.1 Phase 1: 类型定义

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 1.1 | 定义新的 AuthContext 类型 | `types.ts` | 中 |
| 1.2 | 添加类型守卫函数 | `types.ts` | 低 |
| 1.3 | 定义 ScopeVerificationResult | `types.ts` | 低 |

### 8.2 Phase 2: 工具函数

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 2.1 | 实现 computeTokenId | `util/token.ts` | 低 |
| 2.2 | 实现 decodeToken | `util/token.ts` | 中 |
| 2.3 | 实现 verifyIndexPath | `util/scope.ts` | 高 |

### 8.3 Phase 3: 中间件实现

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 3.1 | 实现 JWT 认证中间件 | `middleware/jwt-auth.ts` | 中 |
| 3.2 | 实现 Delegate Token 中间件 | `middleware/delegate-token-auth.ts` | 高 |
| 3.3 | 实现 Access Token 中间件 | `middleware/access-token-auth.ts` | 高 |
| 3.4 | 实现 Scope 验证中间件 | `middleware/scope-validation.ts` | 高 |
| 3.5 | 实现权限检查中间件 | `middleware/permission-check.ts` | 低 |
| 3.6 | 更新 Realm 访问中间件 | `middleware/realm-access.ts` | 中 |

### 8.4 Phase 4: 导出更新

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 4.1 | 更新 middleware/index.ts | `middleware/index.ts` | 低 |
| 4.2 | 移动废弃文件 | `middleware/deprecated/` | 低 |

### 8.5 Phase 5: 测试

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 5.1 | JWT 认证测试 | `tests/middleware/jwt-auth.test.ts` | 中 |
| 5.2 | Token 认证测试 | `tests/middleware/token-auth.test.ts` | 高 |
| 5.3 | Scope 验证测试 | `tests/middleware/scope-validation.test.ts` | 高 |
| 5.4 | 集成测试 | `e2e/auth.test.ts` | 高 |

---

## 附录 A: 中间件导出更新

**`middleware/index.ts`**：

```typescript
// JWT 认证
export {
  createJwtAuthMiddleware,
  type JwtAuthMiddlewareDeps,
} from "./jwt-auth";

// Delegate Token 认证
export {
  createDelegateTokenMiddleware,
  type DelegateTokenMiddlewareDeps,
} from "./delegate-token-auth";

// Access Token 认证
export {
  createAccessTokenMiddleware,
  type AccessTokenMiddlewareDeps,
} from "./access-token-auth";

// Scope 验证
export {
  createScopeValidationMiddleware,
  type ScopeValidationMiddlewareDeps,
} from "./scope-validation";

// 权限检查
export {
  createCanUploadMiddleware,
  createCanManageDepotMiddleware,
} from "./permission-check";

// 访问控制
export {
  createRealmAccessMiddleware,
  createAdminAccessMiddleware,
} from "./realm-access";

// 类型
export type { JwtVerifier } from "./types";

// 废弃的导出（保持向后兼容，但标记为废弃）
/** @deprecated Use createJwtAuthMiddleware or createDelegateTokenMiddleware instead */
export { createAuthMiddleware } from "./deprecated/auth";
```

---

## 附录 B: 错误码对照

| 错误码 | HTTP | 说明 | 中间件 |
|--------|------|------|--------|
| `UNAUTHORIZED` | 401 | 缺少认证信息 | 所有认证中间件 |
| `INVALID_TOKEN_FORMAT` | 401 | Token Base64 格式无效 | Token 中间件 |
| `TOKEN_NOT_FOUND` | 401 | Token ID 不存在 | Token 中间件 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销 | Token 中间件 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 | Token 中间件 |
| `DELEGATE_TOKEN_REQUIRED` | 403 | 需要 Delegate Token | delegateTokenMiddleware |
| `ACCESS_TOKEN_REQUIRED` | 403 | 需要 Access Token | accessTokenMiddleware |
| `REALM_MISMATCH` | 403 | Realm 不匹配 | realmAccessMiddleware |
| `INDEX_PATH_REQUIRED` | 400 | 缺少 X-CAS-Index-Path | scopeValidationMiddleware |
| `NODE_NOT_IN_SCOPE` | 403 | 节点不在 scope 内 | scopeValidationMiddleware |
| `UPLOAD_NOT_ALLOWED` | 403 | 无上传权限 | canUploadMiddleware |
| `DEPOT_MANAGE_NOT_ALLOWED` | 403 | 无 Depot 管理权限 | canManageDepotMiddleware |
| `FORBIDDEN` | 403 | 权限不足 | adminAccessMiddleware |
