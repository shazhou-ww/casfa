# Controller 控制器重构规划

> 版本: 1.0  
> 日期: 2026-02-05  
> 基于: [07-api-changes.md](../07-api-changes.md), [01-dynamodb-changes.md](./01-dynamodb-changes.md)

---

## 目录

1. [概述](#1-概述)
2. [控制器变更总览](#2-控制器变更总览)
3. [新增控制器](#3-新增控制器)
4. [修改控制器](#4-修改控制器)
5. [废弃控制器](#5-废弃控制器)
6. [服务层变更](#6-服务层变更)
7. [实现细节](#7-实现细节)
8. [实现步骤](#8-实现步骤)

---

## 1. 概述

### 1.1 重构背景

当前控制器架构反映了旧的多身份类型认证模型：

```
controllers/
├── auth-clients.ts    # AWP Client 管理
├── auth-tokens.ts     # Agent Token 管理
├── tickets.ts         # Ticket 管理（含 Token 逻辑）
├── ...
```

重构后统一为 Delegate Token 体系：

```
controllers/
├── tokens.ts          # Delegate Token 管理（新增）
├── token-requests.ts  # 客户端授权申请（新增）
├── tickets.ts         # Ticket 管理（简化）
├── ...
```

### 1.2 变更范围

| 类型 | 数量 | 说明 |
|------|------|------|
| **新增控制器** | 2 | Token 管理、授权申请 |
| **修改控制器** | 4 | Tickets、Depots、Chunks、Realm |
| **废弃控制器** | 2 | AuthClients、AuthTokens |

### 1.3 文件结构

```
apps/server/backend/src/controllers/
├── index.ts                # 导出（修改）
├── tokens.ts               # 新增：Delegate Token 管理
├── token-requests.ts       # 新增：客户端授权申请
├── tickets.ts              # 修改：Ticket 管理
├── depots.ts               # 修改：Depot 管理
├── chunks.ts               # 修改：Node 读写
├── realm.ts                # 修改：Realm 信息
├── oauth.ts                # 保持
├── admin.ts                # 保持
├── health.ts               # 保持
├── info.ts                 # 保持
├── deprecated/             # 废弃
│   ├── auth-clients.ts     # AWP Client
│   └── auth-tokens.ts      # 旧 Token
```

---

## 2. 控制器变更总览

### 2.1 控制器映射

| 旧控制器 | 新控制器 | 说明 |
|----------|----------|------|
| `AuthClientsController` | 废弃 | AWP P256 认证 |
| `AuthTokensController` | `TokensController` | 重命名并扩展 |
| - | `TokenRequestsController` | 新增：授权申请 |
| `TicketsController` | `TicketsController` | 简化：移除权限逻辑 |
| `DepotsController` | `DepotsController` | 扩展：Issuer Chain 验证 |
| `ChunksController` | `ChunksController` | 修改：认证上下文变更 |
| `RealmController` | `RealmController` | 修改：认证上下文变更 |

### 2.2 方法变更

| 控制器 | 新增方法 | 修改方法 | 废弃方法 |
|--------|----------|----------|----------|
| `TokensController` | `create`, `list`, `get`, `revoke`, `delegate` | - | - |
| `TokenRequestsController` | `create`, `poll`, `get`, `approve`, `reject` | - | - |
| `TicketsController` | - | `create`, `list`, `get`, `submit` | `commit`, `revoke`, `delete` |
| `DepotsController` | - | `create`, `list`, `get`, `update`, `delete` | `commit` |
| `ChunksController` | - | `get`, `put`, `prepareNodes`, `getMetadata` | - |

---

## 3. 新增控制器

### 3.1 TokensController

**文件**: `controllers/tokens.ts`

```typescript
/**
 * Delegate Token Controller
 *
 * 处理 Token 的创建、列表、撤销和转签发。
 */

import type { Context } from "hono";
import type { Env, JwtAuthContext, DelegateTokenAuthContext } from "../types";
import type { DelegateTokensDb } from "../db/delegate-tokens";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes";
import type { TokenAuditDb } from "../db/token-audit";
import { generateToken, computeTokenId } from "../util/token";

// ============================================================================
// Types
// ============================================================================

export type TokensControllerDeps = {
  delegateTokensDb: DelegateTokensDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  tokenAuditDb: TokenAuditDb;
};

export type TokensController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
  delegate: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createTokensController = (deps: TokensControllerDeps): TokensController => {
  const { delegateTokensDb, scopeSetNodesDb, tokenAuditDb } = deps;

  /**
   * POST /api/tokens
   * 用户创建 Delegate Token
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const body = await c.req.json();

    // 验证 realm 权限
    const expectedRealm = `usr_${auth.userId}`;
    if (body.realm !== expectedRealm) {
      return c.json({ error: "INVALID_REALM", message: "Cannot create token for another realm" }, 400);
    }

    // 解析 scope
    const scopeResult = await resolveScopeFromUris(body.scope, body.realm, scopeSetNodesDb);
    if (!scopeResult.success) {
      return c.json({ error: "INVALID_SCOPE", message: scopeResult.error }, 400);
    }

    // 生成 Token
    const expiresIn = body.expiresIn ?? 30 * 24 * 3600; // 默认 30 天
    const expiresAt = Date.now() + expiresIn * 1000;
    
    const tokenBytes = generateToken({
      type: body.type,
      isUserIssued: true,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      depth: 0,
      expiresAt,
      quota: 0, // Reserved
      issuerHash: computeUserIdHash(auth.userId),
      realmHash: computeRealmHash(body.realm),
      scopeHash: scopeResult.scopeHash,
    });

    const tokenId = computeTokenId(tokenBytes);

    // 创建数据库记录
    const record = await delegateTokensDb.create({
      tokenId,
      tokenType: body.type,
      realm: body.realm,
      expiresAt,
      depth: 0,
      name: body.name,
      issuerId: auth.userId,
      issuerType: "user",
      issuerChain: [auth.userId],
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      isUserIssued: true,
      scopeNodeHash: scopeResult.scopeNodeHash,
      scopeSetNodeId: scopeResult.scopeSetNodeId,
      isRevoked: false,
      createdAt: Date.now(),
    });

    // 记录审计日志
    await tokenAuditDb.log({
      tokenId,
      action: "create",
      actorId: auth.userId,
      actorType: "user",
    });

    return c.json({
      tokenId,
      tokenBase64: Buffer.from(tokenBytes).toString("base64"),
      expiresAt,
    }, 201);
  };

  /**
   * GET /api/tokens
   * 列出用户的 Delegate Token
   */
  const list = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const limit = parseInt(c.req.query("limit") ?? "20");
    const cursor = c.req.query("cursor");

    const realm = `usr_${auth.userId}`;
    const result = await delegateTokensDb.listByRealm(realm, { limit, cursor });

    return c.json({
      tokens: result.items.map(t => ({
        tokenId: t.tokenId,
        name: t.name,
        realm: t.realm,
        tokenType: t.tokenType,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
        isRevoked: t.isRevoked,
        depth: t.depth,
      })),
      nextCursor: result.nextCursor,
    });
  };

  /**
   * GET /api/tokens/:tokenId
   * 获取 Token 详情
   */
  const get = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const tokenId = c.req.param("tokenId");

    const token = await delegateTokensDb.get(tokenId);
    if (!token) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    // 验证用户有权查看此 Token
    const expectedRealm = `usr_${auth.userId}`;
    if (token.realm !== expectedRealm) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    return c.json({
      tokenId: token.tokenId,
      name: token.name,
      realm: token.realm,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
      isRevoked: token.isRevoked,
      depth: token.depth,
      canUpload: token.canUpload,
      canManageDepot: token.canManageDepot,
      issuerChain: token.issuerChain,
    });
  };

  /**
   * POST /api/tokens/:tokenId/revoke
   * 撤销 Token（级联撤销子 Token）
   */
  const revoke = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const tokenId = c.req.param("tokenId");

    const token = await delegateTokensDb.get(tokenId);
    if (!token) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    // 验证用户有权撤销此 Token
    const expectedRealm = `usr_${auth.userId}`;
    if (token.realm !== expectedRealm) {
      return c.json({ error: "TOKEN_NOT_FOUND", message: "Token not found" }, 404);
    }

    if (token.isRevoked) {
      return c.json({ error: "TOKEN_REVOKED", message: "Token already revoked" }, 409);
    }

    // 级联撤销
    const result = await delegateTokensDb.revokeWithCascade(tokenId, auth.userId);

    // 记录审计日志
    await tokenAuditDb.log({
      tokenId,
      action: "revoke",
      actorId: auth.userId,
      actorType: "user",
      details: { revokedCount: result.revokedCount },
    });

    return c.json({
      success: true,
      revokedCount: result.revokedCount,
    });
  };

  /**
   * POST /api/tokens/delegate
   * 转签发 Token
   */
  const delegate = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as DelegateTokenAuthContext;
    const body = await c.req.json();

    // 验证深度限制
    if (auth.depth >= 15) {
      return c.json({ error: "MAX_DEPTH_EXCEEDED", message: "Maximum delegation depth exceeded" }, 400);
    }

    // 验证权限不超过父 Token
    if (body.canUpload && !auth.canUpload) {
      return c.json({ error: "PERMISSION_ESCALATION", message: "Cannot grant upload permission not held" }, 400);
    }
    if (body.canManageDepot && !auth.canManageDepot) {
      return c.json({ error: "PERMISSION_ESCALATION", message: "Cannot grant depot management permission not held" }, 400);
    }

    // 验证 TTL 不超过父 Token
    const parentRemainingTtl = auth.tokenRecord.expiresAt - Date.now();
    const requestedExpiresIn = body.expiresIn ?? Math.floor(parentRemainingTtl / 1000);
    if (requestedExpiresIn * 1000 > parentRemainingTtl) {
      return c.json({ error: "INVALID_TTL", message: "TTL exceeds parent token remaining time" }, 400);
    }

    // 解析并验证 scope（必须是父 scope 的子集）
    const scopeResult = await resolveRelativeScope(body.scope, auth, scopeSetNodesDb);
    if (!scopeResult.success) {
      return c.json({ error: "INVALID_SCOPE", message: scopeResult.error }, 400);
    }

    // 生成新 Token
    const expiresAt = Date.now() + requestedExpiresIn * 1000;
    const newDepth = auth.depth + 1;

    const tokenBytes = generateToken({
      type: body.type,
      isUserIssued: false,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      depth: newDepth,
      expiresAt,
      quota: 0,
      issuerHash: computeTokenIdHash(auth.tokenId),
      realmHash: auth.decoded.realm,
      scopeHash: scopeResult.scopeHash,
    });

    const tokenId = computeTokenId(tokenBytes);

    // 计算新的 issuerChain
    const newIssuerChain = [...auth.issuerChain, auth.tokenId];

    // 创建数据库记录
    await delegateTokensDb.create({
      tokenId,
      tokenType: body.type,
      realm: auth.realm,
      expiresAt,
      depth: newDepth,
      issuerId: auth.tokenId,
      issuerType: "token",
      parentTokenId: auth.tokenId,
      issuerChain: newIssuerChain,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      isUserIssued: false,
      scopeNodeHash: scopeResult.scopeNodeHash,
      scopeSetNodeId: scopeResult.scopeSetNodeId,
      isRevoked: false,
      createdAt: Date.now(),
    });

    // 记录审计日志
    await tokenAuditDb.log({
      tokenId: auth.tokenId,
      action: "delegate",
      actorId: auth.tokenId,
      actorType: "token",
      details: { childTokenId: tokenId },
    });

    return c.json({
      tokenId,
      tokenBase64: Buffer.from(tokenBytes).toString("base64"),
      expiresAt,
    }, 201);
  };

  return { create, list, get, revoke, delegate };
};
```

### 3.2 TokenRequestsController

**文件**: `controllers/token-requests.ts`

```typescript
/**
 * Token Requests Controller
 *
 * 处理客户端授权申请流程。
 */

import type { Context } from "hono";
import type { Env, JwtAuthContext } from "../types";
import type { TokenRequestsDb } from "../db/token-requests";
import type { DelegateTokensDb } from "../db/delegate-tokens";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes";
import { generateDisplayCode, generateRequestId, encryptToken } from "../util/token-request";

// ============================================================================
// Types
// ============================================================================

export type TokenRequestsControllerDeps = {
  tokenRequestsDb: TokenRequestsDb;
  delegateTokensDb: DelegateTokensDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  authorizeUrlBase: string;
};

export type TokenRequestsController = {
  create: (c: Context<Env>) => Promise<Response>;
  poll: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  approve: (c: Context<Env>) => Promise<Response>;
  reject: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createTokenRequestsController = (
  deps: TokenRequestsControllerDeps
): TokenRequestsController => {
  const { tokenRequestsDb, delegateTokensDb, scopeSetNodesDb, authorizeUrlBase } = deps;

  /**
   * POST /api/tokens/requests
   * 客户端发起授权申请
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const body = await c.req.json();

    const requestId = generateRequestId();
    const displayCode = generateDisplayCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 分钟过期

    await tokenRequestsDb.create({
      requestId,
      clientName: body.clientName,
      description: body.description,
      displayCode,
      status: "pending",
      createdAt: Date.now(),
      expiresAt,
    });

    return c.json({
      requestId,
      displayCode,
      authorizeUrl: `${authorizeUrlBase}/authorize/${requestId}`,
      expiresAt,
      pollInterval: 5,
    }, 201);
  };

  /**
   * GET /api/tokens/requests/:requestId/poll
   * 客户端轮询申请状态
   */
  const poll = async (c: Context<Env>): Promise<Response> => {
    const requestId = c.req.param("requestId");

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    // 检查是否过期
    if (request.status === "pending" && request.expiresAt < Date.now()) {
      await tokenRequestsDb.updateStatus(requestId, "expired");
      return c.json({
        requestId,
        status: "expired",
      });
    }

    switch (request.status) {
      case "pending":
        return c.json({
          requestId,
          status: "pending",
          clientName: request.clientName,
          displayCode: request.displayCode,
          requestExpiresAt: request.expiresAt,
        });

      case "approved":
        // 只在首次轮询时返回 encryptedToken
        const response: Record<string, unknown> = {
          requestId,
          status: "approved",
          tokenId: request.tokenId,
          tokenExpiresAt: request.tokenExpiresAt,
        };
        
        if (request.encryptedToken && !request.tokenDelivered) {
          response.encryptedToken = request.encryptedToken;
          // 标记已交付
          await tokenRequestsDb.markDelivered(requestId);
        }
        
        return c.json(response);

      case "rejected":
        return c.json({ requestId, status: "rejected" });

      case "expired":
        return c.json({ requestId, status: "expired" });
    }
  };

  /**
   * GET /api/tokens/requests/:requestId
   * 用户查看申请详情
   */
  const get = async (c: Context<Env>): Promise<Response> => {
    const requestId = c.req.param("requestId");

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    // 检查是否过期
    if (request.status === "pending" && request.expiresAt < Date.now()) {
      return c.json({ error: "REQUEST_EXPIRED", message: "Request has expired" }, 400);
    }

    return c.json({
      requestId,
      status: request.status,
      clientName: request.clientName,
      description: request.description,
      displayCode: request.displayCode,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    });
  };

  /**
   * POST /api/tokens/requests/:requestId/approve
   * 用户批准授权申请
   */
  const approve = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    const requestId = c.req.param("requestId");
    const body = await c.req.json();

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    // 检查状态
    if (request.status !== "pending") {
      return c.json({ error: "REQUEST_ALREADY_PROCESSED", message: "Request already processed" }, 400);
    }

    // 检查过期
    if (request.expiresAt < Date.now()) {
      return c.json({ error: "REQUEST_EXPIRED", message: "Request has expired" }, 400);
    }

    // 验证 realm 权限
    const expectedRealm = `usr_${auth.userId}`;
    if (body.realm !== expectedRealm) {
      return c.json({ error: "INVALID_REALM", message: "Cannot create token for another realm" }, 400);
    }

    // 验证 clientSecret 格式
    if (!body.clientSecret || body.clientSecret.length !== 26) {
      return c.json({ error: "INVALID_CLIENT_SECRET", message: "Invalid client secret format" }, 400);
    }

    // 解析 scope
    const scopeResult = await resolveScopeFromUris(body.scope, body.realm, scopeSetNodesDb);
    if (!scopeResult.success) {
      return c.json({ error: "INVALID_SCOPE", message: scopeResult.error }, 400);
    }

    // 生成 Token（复用 TokensController 的逻辑）
    const expiresIn = body.expiresIn ?? 30 * 24 * 3600;
    const expiresAt = Date.now() + expiresIn * 1000;
    
    const tokenBytes = generateToken({
      type: body.type,
      isUserIssued: true,
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      depth: 0,
      expiresAt,
      quota: 0,
      issuerHash: computeUserIdHash(auth.userId),
      realmHash: computeRealmHash(body.realm),
      scopeHash: scopeResult.scopeHash,
    });

    const tokenId = computeTokenId(tokenBytes);

    // 创建 Token 记录
    await delegateTokensDb.create({
      tokenId,
      tokenType: body.type,
      realm: body.realm,
      expiresAt,
      depth: 0,
      name: body.name,
      issuerId: auth.userId,
      issuerType: "user",
      issuerChain: [auth.userId],
      canUpload: body.canUpload ?? false,
      canManageDepot: body.canManageDepot ?? false,
      isUserIssued: true,
      scopeNodeHash: scopeResult.scopeNodeHash,
      scopeSetNodeId: scopeResult.scopeSetNodeId,
      isRevoked: false,
      createdAt: Date.now(),
    });

    // 加密 Token
    const encryptedToken = encryptToken(tokenBytes, body.clientSecret);

    // 更新申请状态
    await tokenRequestsDb.approve(requestId, {
      tokenId,
      tokenExpiresAt: expiresAt,
      encryptedToken,
      approvedBy: auth.userId,
      approvedAt: Date.now(),
    });

    return c.json({
      success: true,
      tokenId,
      expiresAt,
    });
  };

  /**
   * POST /api/tokens/requests/:requestId/reject
   * 用户拒绝授权申请
   */
  const reject = async (c: Context<Env>): Promise<Response> => {
    const requestId = c.req.param("requestId");

    const request = await tokenRequestsDb.get(requestId);
    if (!request) {
      return c.json({ error: "REQUEST_NOT_FOUND", message: "Request not found" }, 404);
    }

    if (request.status !== "pending") {
      return c.json({ error: "REQUEST_ALREADY_PROCESSED", message: "Request already processed" }, 400);
    }

    if (request.expiresAt < Date.now()) {
      return c.json({ error: "REQUEST_EXPIRED", message: "Request has expired" }, 400);
    }

    await tokenRequestsDb.updateStatus(requestId, "rejected");

    return c.json({ success: true });
  };

  return { create, poll, get, approve, reject };
};
```

---

## 4. 修改控制器

### 4.1 TicketsController 修改

**主要变更**：

| 方法 | 变更 | 说明 |
|------|------|------|
| `create` | 修改 | 返回 Access Token，创建 Ticket 记录，记录 `creatorIssuerId` |
| `list` | 修改 | 基于 Issuer Chain 可见性过滤（使用 `creatorIssuerId`） |
| `get` | 修改 | 基于 Issuer Chain 可见性验证（使用 `creatorIssuerId`） |
| `submit` | 新增 | 替代 `commit`，设置 root 并撤销 Access Token |
| `commit` | 废弃 | 替换为 `submit` |
| `revoke` | 废弃 | 通过撤销 Access Token 实现 |
| `delete` | 废弃 | Ticket 自动过期删除 |

> **重要**：Ticket 的可见性使用 `creatorIssuerId`（创建者的 issuerId，即 Delegate Token 的 issuerId），
> 而不是 `accessTokenId`。这与 Depot 的可见性逻辑保持一致。
> Access Token 不能创建 Ticket，只有 Delegate Token 可以。

**文件**: `controllers/tickets.ts`

```typescript
/**
 * Tickets Controller (Refactored)
 *
 * Ticket 管理，创建时自动签发关联的 Access Token。
 */

import type { Context } from "hono";
import type { Env, DelegateTokenAuthContext, AccessTokenAuthContext } from "../types";
import type { TicketsDb } from "../db/tickets";
import type { DelegateTokensDb } from "../db/delegate-tokens";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes";
import type { RefCountDb } from "../db/refcount";

export type TicketsControllerDeps = {
  ticketsDb: TicketsDb;
  delegateTokensDb: DelegateTokensDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  refCountDb: RefCountDb;
};

export type TicketsController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  submit: (c: Context<Env>) => Promise<Response>;
};

export const createTicketsController = (deps: TicketsControllerDeps): TicketsController => {
  const { ticketsDb, delegateTokensDb, scopeSetNodesDb, refCountDb } = deps;

  /**
   * POST /api/realm/:realmId/tickets
   * 创建 Ticket 并绑定预签发的 Access Token（需要 Access Token）
   * 
   * 设计原则：所有 Realm 数据操作统一使用 Access Token
   * Token 签发与 Ticket 创建解耦：
   *   1. 先用 Delegate Token 签发 Access Token（POST /api/tokens/delegate）
   *   2. 再用 Access Token 创建 Ticket 并绑定（本接口）
   */
  const create = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as DelegateTokenAuthContext;
    const realmId = c.req.param("realmId");
    const body = await c.req.json();

    // 验证调用者是 Access Token
    if (auth.tokenType === "delegate") {
      return c.json({ error: "ACCESS_TOKEN_REQUIRED", message: "Ticket creation requires access token" }, 403);
    }

    // 获取预签发的 Access Token
    const { accessTokenId, title } = body;
    if (!accessTokenId) {
      return c.json({ error: "MISSING_ACCESS_TOKEN_ID", message: "accessTokenId is required" }, 400);
    }

    const boundToken = await delegateTokensDb.get(accessTokenId);
    if (!boundToken) {
      return c.json({ error: "INVALID_BOUND_TOKEN", message: "Access token not found" }, 400);
    }

    // 验证预签发的 Token 是 Access Token
    if (boundToken.tokenType !== "access") {
      return c.json({ error: "INVALID_BOUND_TOKEN", message: "Bound token must be access token" }, 400);
    }

    // 验证 Token 未被绑定到其他 Ticket
    if (boundToken.boundTicketId) {
      return c.json({ error: "TOKEN_ALREADY_BOUND", message: "Access token already bound to a ticket" }, 400);
    }

    // 验证 Token 未被撤销
    if (boundToken.isRevoked) {
      return c.json({ error: "INVALID_BOUND_TOKEN", message: "Access token is revoked" }, 400);
    }

    // 验证 realm 一致
    if (boundToken.realm !== realmId) {
      return c.json({ error: "REALM_MISMATCH", message: "Bound token realm does not match" }, 403);
    }

    // 验证 issuer chain 权限
    // boundToken 的 issuerChain 应该包含调用者的 issuerId，或者共享祖先
    const callerVisibleIssuers = [...auth.issuerChain, auth.tokenRecord.issuerId];
    const boundTokenChain = [...boundToken.issuerChain, boundToken.issuerId];
    const hasPermission = boundTokenChain.some(id => callerVisibleIssuers.includes(id)) ||
                          callerVisibleIssuers.some(id => boundTokenChain.includes(id));
    if (!hasPermission) {
      return c.json({ error: "TICKET_BIND_PERMISSION_DENIED", message: "No permission to bind this token" }, 403);
    }

    // 生成 Ticket ID
    const ticketId = `ticket:${generateUlid()}`;

    // 创建 Ticket 记录
    // 使用 creatorIssuerId（调用者 Access Token 的 issuerId）
    // 可见性逻辑与 Depot 保持一致
    await ticketsDb.create({
      ticketId,
      realm: realmId,
      title,
      status: "pending",
      accessTokenId,
      creatorIssuerId: auth.tokenRecord.issuerId,  // 调用者 Token 的签发者
      createdAt: Date.now(),
    });

    // 标记 Token 已绑定
    await delegateTokensDb.update(accessTokenId, {
      boundTicketId: ticketId,
    });

    return c.json({
      ticketId,
      title,
      status: "pending",
      accessTokenId,
    }, 201);
  };

  /**
   * GET /api/realm/:realmId/tickets
   * 列出 Ticket（基于 Issuer Chain 可见性）
   * 
   * 可见性规则：Token 可以看到其 issuerChain 中任意签发者创建的 Ticket
   */
  const list = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as DelegateTokenAuthContext;  // 注意：需要 Delegate Token
    const realmId = c.req.param("realmId");
    const limit = parseInt(c.req.query("limit") ?? "20");
    const cursor = c.req.query("cursor");
    const status = c.req.query("status");

    // 计算可见的签发者列表
    const visibleIssuers = [...auth.issuerChain, auth.tokenRecord.issuerId];

    // 获取可见的 Ticket（基于 creatorIssuerId）
    const result = await ticketsDb.listByVisibleIssuers(realmId, visibleIssuers, {
      limit,
      cursor,
      status,
    });

    return c.json({
      tickets: result.items.map(t => ({
        ticketId: t.ticketId,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt,
      })),
      nextCursor: result.nextCursor,
    });
  };

  /**
   * GET /api/realm/:realmId/tickets/:ticketId
   * 获取 Ticket 详情
   * 
   * 可见性规则：Token 可以看到其 issuerChain 中任意签发者创建的 Ticket
   */
  const get = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as DelegateTokenAuthContext;  // 注意：需要 Delegate Token
    const realmId = c.req.param("realmId");
    const ticketId = c.req.param("ticketId");

    const ticket = await ticketsDb.get(realmId, ticketId);
    if (!ticket) {
      return c.json({ error: "NOT_FOUND", message: "Ticket not found" }, 404);
    }

    // 验证可见性：使用 creatorIssuerId
    const visibleIssuers = [...auth.issuerChain, auth.tokenRecord.issuerId];
    if (!visibleIssuers.includes(ticket.creatorIssuerId)) {
      return c.json({ error: "NOT_FOUND", message: "Ticket not found" }, 404);
    }

    // 获取关联的 Access Token 以获取 expiresAt
    const accessToken = await delegateTokensDb.get(ticket.accessTokenId);

    const response: Record<string, unknown> = {
      ticketId: ticket.ticketId,
      title: ticket.title,
      status: ticket.status,
      accessTokenId: ticket.accessTokenId,
      creatorIssuerId: ticket.creatorIssuerId,  // 返回签发者 ID
      createdAt: ticket.createdAt,
    };

    if (ticket.status === "submitted") {
      response.root = ticket.root;
      response.submittedAt = ticket.submittedAt;
    } else {
      response.root = null;
    }

    if (accessToken) {
      response.expiresAt = accessToken.expiresAt;
    }

    return c.json(response);
  };

  /**
   * POST /api/realm/:realmId/tickets/:ticketId/submit
   * 提交 Ticket
   */
  const submit = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as AccessTokenAuthContext;
    const realmId = c.req.param("realmId");
    const ticketId = c.req.param("ticketId");
    const body = await c.req.json();

    const ticket = await ticketsDb.get(realmId, ticketId);
    if (!ticket) {
      return c.json({ error: "NOT_FOUND", message: "Ticket not found" }, 404);
    }

    // 验证 Access Token 是否是此 Ticket 关联的
    if (ticket.accessTokenId !== auth.tokenId) {
      return c.json({ error: "FORBIDDEN", message: "Access token not associated with this ticket" }, 403);
    }

    // 检查状态
    if (ticket.status === "submitted") {
      return c.json({ error: "CONFLICT", message: "Ticket already submitted" }, 409);
    }

    // 验证 root 节点存在
    const rootExists = await refCountDb.exists(body.root);
    if (!rootExists) {
      return c.json({ error: "INVALID_REQUEST", message: "Root node does not exist" }, 400);
    }

    // 更新 Ticket 状态
    const updatedTicket = await ticketsDb.submit(realmId, ticketId, body.root);

    // 增加 root 节点引用计数
    await refCountDb.increment(body.root);

    // 撤销关联的 Access Token
    await delegateTokensDb.revoke(ticket.accessTokenId, `ticket_submit:${ticketId}`);

    return c.json({
      success: true,
      status: "submitted",
      root: body.root,
    });
  };

  return { create, list, get, submit };
};
```

### 4.2 DepotsController 修改

**主要变更**：

| 方法 | 变更 | 说明 |
|------|------|------|
| `create` | 修改 | 记录 `creatorIssuerId` 和 `creatorTokenId` |
| `list` | 修改 | 基于 Issuer Chain 可见性过滤 |
| `get` | 修改 | 基于 Issuer Chain 可见性验证 |
| `update` | 修改 | 验证 Issuer Chain 权限 |
| `delete` | 修改 | 验证 Issuer Chain 权限 |
| `commit` | 废弃 | 使用 `update` 更新 root |

**关键代码片段**：

```typescript
/**
 * 检查 Token 是否可以访问 Depot
 */
function canAccessDepot(
  tokenRecord: DelegateTokenRecord,
  depot: DepotRecord
): boolean {
  // Token 可以访问其 issuerChain 中任意签发者创建的 Depot
  const visibleIssuers = [...tokenRecord.issuerChain, tokenRecord.issuerId];
  return visibleIssuers.includes(depot.creatorIssuerId);
}

/**
 * POST /api/realm/:realmId/depots
 */
const create = async (c: Context<Env>): Promise<Response> => {
  const auth = c.get("auth") as AccessTokenAuthContext;
  const realmId = c.req.param("realmId");
  const body = await c.req.json();

  const depot = await depotsDb.create(realmId, {
    name: body.name,
    root: body.root,
    maxHistory: body.maxHistory ?? 10,
    // 新增：记录创建者信息
    creatorIssuerId: auth.tokenRecord.issuerId,
    creatorTokenId: auth.tokenId,
  });

  return c.json(depot, 201);
};
```

### 4.3 ChunksController 修改

**主要变更**：

| 方法 | 变更 | 说明 |
|------|------|------|
| `get` | 修改 | 认证上下文变更，依赖 scope 验证中间件 |
| `put` | 修改 | 认证上下文变更，依赖 canUpload 中间件 |
| `prepareNodes` | **保留** | 上传前检查哪些节点需要上传，客户端批量上传优化必需 |
| `getMetadata` | 保留 | 获取节点元信息 |

> **重要**：`prepareNodes` 不废弃！客户端在批量上传前需要调用此 API 检查哪些节点已存在，
> 避免重复上传，这是 CAS 上传流程的关键优化点。

**关键代码片段**：

```typescript
/**
 * GET /api/realm/:realmId/nodes/:key
 */
const get = async (c: Context<Env>): Promise<Response> => {
  const auth = c.get("auth") as AccessTokenAuthContext;
  const realmId = c.req.param("realmId");
  const key = c.req.param("key");

  // Scope 验证已由中间件完成
  const scopeVerification = c.get("scopeVerification");
  if (!scopeVerification?.valid) {
    return c.json({ error: "NODE_NOT_IN_SCOPE", message: "Node not in scope" }, 403);
  }

  // 读取节点
  const node = await storageService.get(realmId, key);
  if (!node) {
    return c.json({ error: "NOT_FOUND", message: "Node not found" }, 404);
  }

  return new Response(node.data, {
    headers: { "Content-Type": "application/octet-stream" },
  });
};

/**
 * PUT /api/realm/:realmId/nodes/:key
 */
const put = async (c: Context<Env>): Promise<Response> => {
  const auth = c.get("auth") as AccessTokenAuthContext;
  const realmId = c.req.param("realmId");
  const key = c.req.param("key");

  // canUpload 验证已由中间件完成

  // 读取 body
  const data = await c.req.arrayBuffer();

  // 验证 key（content-addressed）
  const computedKey = computeNodeKey(new Uint8Array(data));
  if (computedKey !== key) {
    return c.json({ error: "INVALID_REQUEST", message: "Key does not match content hash" }, 400);
  }

  // 写入存储
  await storageService.put(realmId, key, new Uint8Array(data), {
    tokenId: auth.tokenId,
  });

  return c.json({ success: true, key });
};

/**
 * POST /api/realm/:realmId/nodes/prepare
 * 
 * 批量检查节点是否存在，返回需要上传的节点列表。
 * 这是上传流程的关键优化 API，避免重复上传已存在的节点。
 */
const prepareNodes = async (c: Context<Env>): Promise<Response> => {
  const auth = c.get("auth") as AccessTokenAuthContext;
  const realmId = c.req.param("realmId");
  const body = await c.req.json();

  // 验证请求格式
  const keys = body.keys as string[];
  if (!Array.isArray(keys) || keys.length === 0) {
    return c.json({ error: "INVALID_REQUEST", message: "keys must be a non-empty array" }, 400);
  }

  // 限制单次请求的节点数量
  const MAX_KEYS = 1000;
  if (keys.length > MAX_KEYS) {
    return c.json({ 
      error: "INVALID_REQUEST", 
      message: `Maximum ${MAX_KEYS} keys per request` 
    }, 400);
  }

  // 批量检查节点是否存在
  const existingKeys = await storageService.batchCheckExists(realmId, keys);
  
  // 返回需要上传的节点（不存在的节点）
  const missing = keys.filter(key => !existingKeys.has(key));

  return c.json({
    missing,
    existing: keys.length - missing.length,
  });
};

/**
 * GET /api/realm/:realmId/nodes/:key/metadata
 * 
 * 获取节点元信息，包括类型、大小、子节点等。
 */
const getMetadata = async (c: Context<Env>): Promise<Response> => {
  const auth = c.get("auth") as AccessTokenAuthContext;
  const realmId = c.req.param("realmId");
  const key = c.req.param("key");

  // Scope 验证已由中间件完成
  const scopeVerification = c.get("scopeVerification");
  if (!scopeVerification?.valid) {
    return c.json({ error: "NODE_NOT_IN_SCOPE", message: "Node not in scope" }, 403);
  }

  // 获取节点元信息
  const metadata = await storageService.getMetadata(realmId, key);
  if (!metadata) {
    return c.json({ error: "NOT_FOUND", message: "Node not found" }, 404);
  }

  return c.json(metadata);
};
```

---

## 5. 废弃控制器

### 5.1 AuthClientsController（全部废弃）

**文件**: `controllers/auth-clients.ts`

| 方法 | 说明 | 处理方式 |
|------|------|----------|
| `init` | AWP 初始化 | 移至 `deprecated/` |
| `get` | 获取 Client 状态 | 移至 `deprecated/` |
| `complete` | 完成 AWP 认证 | 移至 `deprecated/` |
| `list` | 列出 Clients | 移至 `deprecated/` |
| `revoke` | 撤销 Client | 移至 `deprecated/` |

### 5.2 AuthTokensController（替换）

**文件**: `controllers/auth-tokens.ts`

| 方法 | 新位置 | 说明 |
|------|--------|------|
| `create` | `TokensController.create` | 功能扩展 |
| `list` | `TokensController.list` | 功能保持 |
| `revoke` | `TokensController.revoke` | 增加级联撤销 |

### 5.3 废弃代码处理

```
controllers/deprecated/
├── auth-clients.ts    # 完整保留但标记废弃
└── auth-tokens.ts     # 完整保留但标记废弃
```

---

## 6. 服务层变更

### 6.1 新增服务

| 服务 | 文件 | 说明 |
|------|------|------|
| `TokenService` | `services/token.ts` | Token 生成、验证、转签发逻辑 |
| `ScopeService` | `services/scope.ts` | Scope 解析、验证、相对路径计算 |
| `EncryptionService` | `services/encryption.ts` | Token 加密/解密（授权申请） |

### 6.2 TokenService

```typescript
/**
 * Token Service
 *
 * 封装 Token 生成和验证的核心逻辑。
 */

export type TokenService = {
  generate: (options: GenerateTokenOptions) => Uint8Array;
  decode: (tokenBytes: Uint8Array) => DecodedDelegateToken;
  computeId: (tokenBytes: Uint8Array) => string;
  validatePermissions: (
    requested: TokenPermissions,
    parent: DelegateTokenRecord
  ) => ValidationResult;
};

export const createTokenService = (): TokenService => {
  // ... 实现
};
```

### 6.3 ScopeService

```typescript
/**
 * Scope Service
 *
 * 封装 Scope 解析和验证逻辑。
 */

export type ScopeService = {
  // 从 CAS URI 解析 scope（用户签发）
  resolveScopeFromUris: (
    uris: string[],
    realm: string
  ) => Promise<ScopeResolution>;

  // 从相对 index path 解析 scope（转签发）
  resolveRelativeScope: (
    paths: string[],
    parentToken: DelegateTokenRecord
  ) => Promise<ScopeResolution>;

  // 验证节点是否在 scope 内
  verifyNodeInScope: (
    nodeKey: string,
    indexPath: string,
    scopeRoots: string[]
  ) => Promise<ScopeVerification>;
};
```

---

## 7. 实现细节

### 7.1 辅助函数

**文件**: `util/token-request.ts`

```typescript
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";
import { crockfordBase32Encode, crockfordBase32Decode } from "./encoding";

/**
 * 生成请求 ID
 */
export function generateRequestId(): string {
  const bytes = randomBytes(16);
  return `req_${bytes.toString("base64url")}`;
}

/**
 * 生成显示验证码 (XXXX-YYYY)
 */
export function generateDisplayCode(): string {
  const bytes = randomBytes(5);
  const encoded = crockfordBase32Encode(bytes);
  return `${encoded.slice(0, 4)}-${encoded.slice(4, 8)}`;
}

/**
 * 加密 Token (AES-256-GCM)
 */
export function encryptToken(tokenBytes: Uint8Array, clientSecret: string): string {
  // 解码 clientSecret
  const secretBytes = crockfordBase32Decode(clientSecret);
  
  // 派生密钥 (HKDF-SHA256)
  const key = createHash("sha256")
    .update(secretBytes)
    .update("casfa-token-encryption-v1")
    .digest();

  // 生成 IV
  const iv = randomBytes(12);

  // 加密
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(tokenBytes),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // 组合: IV (12) + Ciphertext + AuthTag (16)
  return Buffer.concat([iv, encrypted, authTag]).toString("base64");
}

/**
 * 解密 Token
 */
export function decryptToken(encryptedBase64: string, clientSecret: string): Uint8Array {
  const data = Buffer.from(encryptedBase64, "base64");
  
  const secretBytes = crockfordBase32Decode(clientSecret);
  const key = createHash("sha256")
    .update(secretBytes)
    .update("casfa-token-encryption-v1")
    .digest();

  const iv = data.slice(0, 12);
  const authTag = data.slice(-16);
  const ciphertext = data.slice(12, -16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}
```

### 7.2 Issuer Chain 可见性辅助

```typescript
/**
 * 检查 Ticket 是否对 Token 可见
 * 
 * 重要：使用 creatorIssuerId（而非 creatorTokenId）确保与 Depot 逻辑一致。
 * Token 可以看到其 issuerChain 中任意签发者创建的 Ticket。
 */
function isTicketVisibleToToken(
  ticket: TicketRecord,
  tokenRecord: DelegateTokenRecord
): boolean {
  const visibleIssuers = [...tokenRecord.issuerChain, tokenRecord.issuerId];
  return visibleIssuers.includes(ticket.creatorIssuerId);
}

/**
 * 检查 Depot 是否对 Token 可见
 * 
 * Token 可以看到其 issuerChain 中任意签发者创建的 Depot。
 */
function isDepotVisibleToToken(
  depot: DepotRecord,
  tokenRecord: DelegateTokenRecord
): boolean {
  const visibleIssuers = [...tokenRecord.issuerChain, tokenRecord.issuerId];
  return visibleIssuers.includes(depot.creatorIssuerId);
}

/**
 * 获取 Token 可见的所有签发者 ID 列表
 */
function getVisibleIssuers(tokenRecord: DelegateTokenRecord): string[] {
  return [...tokenRecord.issuerChain, tokenRecord.issuerId];
}
```

---

## 8. 实现步骤

### 8.1 Phase 1: 服务层

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 1.1 | 实现 TokenService | `services/token.ts` | 高 |
| 1.2 | 实现 ScopeService | `services/scope.ts` | 高 |
| 1.3 | 实现 EncryptionService | `services/encryption.ts` | 中 |

### 8.2 Phase 2: 新控制器

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 2.1 | 实现 TokensController | `controllers/tokens.ts` | 高 |
| 2.2 | 实现 TokenRequestsController | `controllers/token-requests.ts` | 高 |

### 8.3 Phase 3: 修改控制器

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 3.1 | 重构 TicketsController | `controllers/tickets.ts` | 高 |
| 3.2 | 重构 DepotsController | `controllers/depots.ts` | 中 |
| 3.3 | 重构 ChunksController | `controllers/chunks.ts` | 中 |
| 3.4 | 更新 RealmController | `controllers/realm.ts` | 低 |

### 8.4 Phase 4: 导出更新

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 4.1 | 更新控制器导出 | `controllers/index.ts` | 低 |
| 4.2 | 移动废弃控制器 | `controllers/deprecated/` | 低 |

### 8.5 Phase 5: 测试

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 5.1 | TokensController 测试 | `tests/controllers/tokens.test.ts` | 高 |
| 5.2 | TokenRequestsController 测试 | `tests/controllers/token-requests.test.ts` | 高 |
| 5.3 | TicketsController 测试 | `tests/controllers/tickets.test.ts` | 高 |
| 5.4 | 集成测试 | `e2e/*.test.ts` | 高 |

---

## 附录 A: 控制器导出更新

**`controllers/index.ts`**：

```typescript
// 新控制器
export { createTokensController, type TokensController } from "./tokens";
export { createTokenRequestsController, type TokenRequestsController } from "./token-requests";

// 修改的控制器
export { createTicketsController, type TicketsController } from "./tickets";
export { createDepotsController, type DepotsController } from "./depots";
export { createChunksController, type ChunksController } from "./chunks";
export { createRealmController, type RealmController } from "./realm";

// 保持的控制器
export { createOAuthController, type OAuthController } from "./oauth";
export { createAdminController, type AdminController } from "./admin";
export { createHealthController, type HealthController } from "./health";
export { createInfoController, type InfoController } from "./info";

// 废弃的控制器（保持向后兼容）
/** @deprecated Use TokensController instead */
export { createAuthTokensController } from "./deprecated/auth-tokens";
/** @deprecated AWP authentication is deprecated */
export { createAuthClientsController } from "./deprecated/auth-clients";
```

---

## 附录 B: 响应格式变更

### Ticket 创建响应

```json
// 旧格式
{
  "ticketId": "xxx",
  "purpose": "...",
  "scope": [...],
  "commit": {...},
  "expiresAt": 123456789
}

// 新格式（两步流程）
// 步骤 1: POST /api/tokens/delegate 签发 Access Token
{
  "tokenId": "dlt1_xxx",
  "tokenBase64": "SGVsbG8gV29...",
  "expiresAt": 123456789
}

// 步骤 2: POST /api/realm/:realmId/tickets 创建 Ticket
{
  "ticketId": "ticket:xxx",
  "title": "...",
  "status": "pending",
  "accessTokenId": "dlt1_xxx"
}
```

> **设计变更**：Ticket 创建由原来的「Delegate Token 直接创建并自动签发」改为「Access Token 创建并绑定预签发的 Token」。
> 所有 Realm 数据操作统一使用 Access Token，Delegate Token 只负责签发 Token。

### Depot 创建响应

```json
// 旧格式
{
  "depotId": "depot:xxx",
  "title": "...",
  "root": "...",
  "createdAt": 123456789
}

// 新格式
{
  "depotId": "depot:xxx",
  "name": "...",
  "root": "...",
  "creatorIssuerId": "dlt1_xxx",
  "createdAt": 123456789
}
```

### Token 列表响应

```json
// 旧格式 (authTokens)
{
  "tokens": [{
    "id": "casfa_xxx",
    "name": "...",
    "createdAt": 123456789
  }]
}

// 新格式
{
  "tokens": [{
    "tokenId": "dlt1_xxx",
    "name": "...",
    "realm": "usr_xxx",
    "tokenType": "delegate",
    "expiresAt": 123456789,
    "createdAt": 123456789,
    "isRevoked": false,
    "depth": 0
  }],
  "nextCursor": "xxx"
}
```
