# Router 路由重构规划

> 版本: 1.0  
> 日期: 2026-02-05  
> 基于: [07-api-changes.md](../07-api-changes.md), [casfa-api](../../casfa-api/README.md)

---

## 目录

1. [概述](#1-概述)
2. [路由变更总览](#2-路由变更总览)
3. [新增路由](#3-新增路由)
4. [修改路由](#4-修改路由)
5. [废弃路由](#5-废弃路由)
6. [路由结构重组](#6-路由结构重组)
7. [Schema 更新](#7-schema-更新)
8. [实现步骤](#8-实现步骤)

---

## 1. 概述

### 1.1 重构背景

当前路由结构反映了旧的三层认证模型：

```
/api/auth/clients/*    # P256 公钥认证（AWP）
/api/auth/tokens/*     # Agent Token 管理
/api/realm/*           # Ticket 认证访问
```

重构后统一为 Delegate Token 体系：

```
/api/tokens/*          # Delegate Token 管理
/api/tokens/requests/* # 客户端授权申请
/api/tokens/delegate   # Token 转签发
/api/realm/*           # Access Token 认证访问
```

### 1.2 变更范围

| 类型 | 数量 | 说明 |
|------|------|------|
| **新增路由** | 6 | Token 管理、授权申请、转签发 |
| **修改路由** | 12 | Realm 路由认证方式变更 |
| **废弃路由** | 7 | AWP Client 相关、旧 Token 相关 |

### 1.3 文件位置

```
apps/server/backend/src/
├── router.ts              # 主路由文件（修改）
├── schemas/
│   ├── index.ts           # Schema 导出（修改）
│   ├── token.ts           # 新增：Token 相关 Schema
│   └── token-request.ts   # 新增：授权申请 Schema
```

---

## 2. 路由变更总览

### 2.1 路由前缀映射

| 旧前缀 | 新前缀 | 说明 |
|--------|--------|------|
| `/api/auth/clients/*` | 废弃 | AWP P256 认证 |
| `/api/auth/tokens/*` | `/api/tokens/*` | 路径简化 |
| - | `/api/tokens/requests/*` | 新增：客户端授权申请 |
| - | `/api/tokens/delegate` | 新增：Token 转签发 |
| `/api/realm/*` | `/api/realm/*` | 保持，认证方式变更 |

### 2.2 认证方式变更

| 路由类型 | 旧认证 | 新认证 |
|----------|--------|--------|
| Token 管理 | User JWT | User JWT（保持） |
| 授权申请（客户端侧） | - | 无需认证 |
| 授权申请（用户侧） | - | User JWT |
| Token 转签发 | - | Delegate Token |
| Realm 数据操作 | Ticket | Access Token |
| Ticket 创建 | Agent Token | Delegate Token |

---

## 3. 新增路由

### 3.1 Token 管理路由

| 方法 | 路径 | 认证 | Controller | Schema |
|------|------|------|------------|--------|
| POST | `/api/tokens` | JWT | `tokens.create` | `CreateDelegateTokenSchema` |
| GET | `/api/tokens` | JWT | `tokens.list` | - |
| GET | `/api/tokens/:tokenId` | JWT | `tokens.get` | - |
| POST | `/api/tokens/:tokenId/revoke` | JWT | `tokens.revoke` | - |
| POST | `/api/tokens/delegate` | Delegate Token | `tokens.delegate` | `DelegateTokenSchema` |

**路由注册代码**：

```typescript
// Token Management Routes
app.post(
  "/api/tokens",
  deps.jwtAuthMiddleware,
  zValidator("json", CreateDelegateTokenSchema),
  deps.tokens.create
);
app.get("/api/tokens", deps.jwtAuthMiddleware, deps.tokens.list);
app.get("/api/tokens/:tokenId", deps.jwtAuthMiddleware, deps.tokens.get);
app.post(
  "/api/tokens/:tokenId/revoke",
  deps.jwtAuthMiddleware,
  deps.tokens.revoke
);
app.post(
  "/api/tokens/delegate",
  deps.delegateTokenAuthMiddleware,
  zValidator("json", DelegateTokenSchema),
  deps.tokens.delegate
);
```

### 3.2 客户端授权申请路由

| 方法 | 路径 | 认证 | Controller | Schema |
|------|------|------|------------|--------|
| POST | `/api/tokens/requests` | 无 | `tokenRequests.create` | `CreateTokenRequestSchema` |
| GET | `/api/tokens/requests/:requestId/poll` | 无 | `tokenRequests.poll` | - |
| GET | `/api/tokens/requests/:requestId` | JWT | `tokenRequests.get` | - |
| POST | `/api/tokens/requests/:requestId/approve` | JWT | `tokenRequests.approve` | `ApproveTokenRequestSchema` |
| POST | `/api/tokens/requests/:requestId/reject` | JWT | `tokenRequests.reject` | - |

**路由注册代码**：

```typescript
// Token Request Routes (Client Authorization Flow)
app.post(
  "/api/tokens/requests",
  zValidator("json", CreateTokenRequestSchema),
  deps.tokenRequests.create
);
app.get(
  "/api/tokens/requests/:requestId/poll",
  deps.tokenRequests.poll
);
app.get(
  "/api/tokens/requests/:requestId",
  deps.jwtAuthMiddleware,
  deps.tokenRequests.get
);
app.post(
  "/api/tokens/requests/:requestId/approve",
  deps.jwtAuthMiddleware,
  zValidator("json", ApproveTokenRequestSchema),
  deps.tokenRequests.approve
);
app.post(
  "/api/tokens/requests/:requestId/reject",
  deps.jwtAuthMiddleware,
  deps.tokenRequests.reject
);
```

> **注意**：授权申请路由 `/requests/` 必须在 `/:tokenId` 之前注册，避免路由匹配冲突。

---

## 4. 修改路由

### 4.1 Realm 路由认证变更

| 方法 | 路径 | 旧认证 | 新认证 | 说明 |
|------|------|--------|--------|------|
| GET | `/:realmId` | Agent/Ticket | Access Token | Realm 信息 |
| GET | `/:realmId/usage` | Agent/Ticket | Access Token | 使用统计 |
| GET | `/:realmId/nodes/:key` | Ticket | Access Token | 读取节点 |
| PUT | `/:realmId/nodes/:key` | Ticket | Access Token (canUpload) | 写入节点 |
| GET | `/:realmId/depots` | Agent/Ticket | Access Token | 列出 Depot |
| POST | `/:realmId/depots` | Agent/Ticket | Access Token (canManageDepot) | 创建 Depot |
| GET | `/:realmId/depots/:depotId` | Agent/Ticket | Access Token | Depot 详情 |
| PATCH | `/:realmId/depots/:depotId` | Agent/Ticket | Access Token (canManageDepot) | 更新 Depot |
| DELETE | `/:realmId/depots/:depotId` | Agent/Ticket | Access Token (canManageDepot) | 删除 Depot |
| GET | `/:realmId/tickets` | Agent/Ticket | Access Token | 列出 Ticket |
| POST | `/:realmId/tickets` | Agent | **Delegate Token** | 创建 Ticket |
| GET | `/:realmId/tickets/:ticketId` | Agent/Ticket | Access Token | Ticket 详情 |
| POST | `/:realmId/tickets/:ticketId/submit` | Ticket | Access Token | 提交 Ticket |

### 4.2 新增 Header 要求

节点读取 API 新增 `X-CAS-Index-Path` Header：

```typescript
// Node read requires index path proof
realmRouter.get(
  "/:realmId/nodes/:key",
  deps.accessTokenMiddleware,
  deps.scopeValidationMiddleware,  // 新增：验证 X-CAS-Index-Path
  deps.chunks.get
);
```

### 4.3 Ticket API 变更

| 操作 | 旧 API | 新 API | 说明 |
|------|--------|--------|------|
| 创建 | POST `/:realmId/tickets` | 保持 | 返回增加 `accessTokenId`, `accessTokenBase64` |
| 提交 | POST `/:ticketId/commit` | POST `/:ticketId/submit` | 路径重命名，body 改为 `{ root: "..." }` |
| 撤销 | POST `/:ticketId/revoke` | 废弃 | 通过撤销 Access Token 实现 |
| 删除 | DELETE `/:ticketId` | 废弃 | Ticket 自动过期删除 |

---

## 5. 废弃路由

### 5.1 AWP Client 路由（全部废弃）

```typescript
// 废弃：AWP P256 公钥认证
app.post("/api/auth/clients/init", ...);      // 废弃
app.get("/api/auth/clients/:clientId", ...);  // 废弃
app.post("/api/auth/clients/complete", ...);  // 废弃
app.get("/api/auth/clients", ...);            // 废弃
app.delete("/api/auth/clients/:clientId", ...); // 废弃
```

### 5.2 旧 Token 路由（替换）

```typescript
// 废弃：旧的 auth/tokens 路由
// 替换为新的 /api/tokens 路由
app.post("/api/auth/tokens", ...);            // → /api/tokens
app.get("/api/auth/tokens", ...);             // → /api/tokens
app.delete("/api/auth/tokens/:id", ...);      // → /api/tokens/:tokenId/revoke
```

### 5.3 Ticket 路由（部分废弃）

```typescript
// 废弃
realmRouter.post("/:realmId/tickets/:ticketId/revoke", ...);  // 通过 Token 撤销
realmRouter.delete("/:realmId/tickets/:ticketId", ...);       // 自动过期

// 重命名
realmRouter.post("/:realmId/tickets/:ticketId/commit", ...);  // → /submit
```

### 5.4 废弃路由清理方案

**阶段 1：标记废弃**

```typescript
// 废弃路由返回 410 Gone 并提示迁移
const deprecatedHandler = (c) => c.json({
  error: "DEPRECATED",
  message: "This endpoint is deprecated. Please use /api/tokens instead.",
  migration: "See https://docs.casfa.io/migration/v2"
}, 410);

app.all("/api/auth/clients/*", deprecatedHandler);
app.all("/api/auth/tokens/*", deprecatedHandler);
```

**阶段 2：移除路由**

在确认无流量后移除废弃路由注册代码。

---

## 6. 路由结构重组

### 6.1 新的 RouterDeps 类型

```typescript
export type RouterDeps = {
  // Controllers
  health: HealthController;
  info: InfoController;
  oauth: OAuthController;
  admin: AdminController;
  tokens: TokensController;           // 新增：替代 authTokens
  tokenRequests: TokenRequestsController;  // 新增
  realm: RealmController;
  tickets: TicketsController;         // 修改
  chunks: ChunksController;           // 修改
  depots: DepotsController;           // 修改
  mcp: McpController;

  // Middleware
  jwtAuthMiddleware: MiddlewareHandler<Env>;       // 新增：仅 JWT
  delegateTokenMiddleware: MiddlewareHandler<Env>; // 新增：Delegate Token
  accessTokenMiddleware: MiddlewareHandler<Env>;   // 新增：Access Token
  realmAccessMiddleware: MiddlewareHandler<Env>;   // 修改
  scopeValidationMiddleware: MiddlewareHandler<Env>; // 新增
  canUploadMiddleware: MiddlewareHandler<Env>;     // 新增：替代 writeAccess
  canManageDepotMiddleware: MiddlewareHandler<Env>; // 新增
  adminAccessMiddleware: MiddlewareHandler<Env>;   // 保持
};
```

### 6.2 移除的依赖

```typescript
// 移除
authMiddleware: MiddlewareHandler<Env>;      // 拆分为多个中间件
ticketAuthMiddleware: MiddlewareHandler<Env>; // 废弃
writeAccessMiddleware: MiddlewareHandler<Env>; // 替换为 canUploadMiddleware
authClients: AuthClientsController;          // 废弃
authTokens: AuthTokensController;            // 替换为 tokens
```

### 6.3 完整路由结构

```typescript
export const createRouter = (deps: RouterDeps): Hono<Env> => {
  const app = new Hono<Env>();

  // Error handler & CORS (保持)
  app.onError(...);
  app.use("*", cors(...));

  // ============================================================================
  // Health & Info (保持)
  // ============================================================================
  app.get("/api/health", deps.health.check);
  app.get("/api/info", deps.info.getInfo);

  // ============================================================================
  // OAuth Routes (保持)
  // ============================================================================
  app.get("/api/oauth/config", deps.oauth.getConfig);
  app.post("/api/oauth/login", zValidator("json", LoginSchema), deps.oauth.login);
  app.post("/api/oauth/refresh", zValidator("json", RefreshSchema), deps.oauth.refresh);
  app.post("/api/oauth/token", zValidator("json", TokenExchangeSchema), deps.oauth.exchangeToken);
  app.get("/api/oauth/me", deps.jwtAuthMiddleware, deps.oauth.me);

  // ============================================================================
  // Token Management Routes (新增)
  // ============================================================================
  
  // 客户端授权申请（放在 :tokenId 之前避免路由冲突）
  app.post(
    "/api/tokens/requests",
    zValidator("json", CreateTokenRequestSchema),
    deps.tokenRequests.create
  );
  app.get("/api/tokens/requests/:requestId/poll", deps.tokenRequests.poll);
  app.get(
    "/api/tokens/requests/:requestId",
    deps.jwtAuthMiddleware,
    deps.tokenRequests.get
  );
  app.post(
    "/api/tokens/requests/:requestId/approve",
    deps.jwtAuthMiddleware,
    zValidator("json", ApproveTokenRequestSchema),
    deps.tokenRequests.approve
  );
  app.post(
    "/api/tokens/requests/:requestId/reject",
    deps.jwtAuthMiddleware,
    deps.tokenRequests.reject
  );

  // Token 转签发
  app.post(
    "/api/tokens/delegate",
    deps.delegateTokenMiddleware,
    zValidator("json", DelegateTokenSchema),
    deps.tokens.delegate
  );

  // Token CRUD
  app.post(
    "/api/tokens",
    deps.jwtAuthMiddleware,
    zValidator("json", CreateDelegateTokenSchema),
    deps.tokens.create
  );
  app.get("/api/tokens", deps.jwtAuthMiddleware, deps.tokens.list);
  app.get("/api/tokens/:tokenId", deps.jwtAuthMiddleware, deps.tokens.get);
  app.post(
    "/api/tokens/:tokenId/revoke",
    deps.jwtAuthMiddleware,
    deps.tokens.revoke
  );

  // ============================================================================
  // Admin Routes (保持)
  // ============================================================================
  app.get(
    "/api/admin/users",
    deps.jwtAuthMiddleware,
    deps.adminAccessMiddleware,
    deps.admin.listUsers
  );
  app.patch(
    "/api/admin/users/:userId",
    deps.jwtAuthMiddleware,
    deps.adminAccessMiddleware,
    zValidator("json", UpdateUserRoleSchema),
    deps.admin.updateRole
  );

  // ============================================================================
  // MCP Route (保持)
  // ============================================================================
  app.post("/api/mcp", deps.jwtAuthMiddleware, deps.mcp.handle);

  // ============================================================================
  // Realm Routes (重构)
  // ============================================================================
  const realmRouter = new Hono<Env>();

  // Realm info
  realmRouter.get(
    "/:realmId",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.realm.getInfo
  );
  realmRouter.get(
    "/:realmId/usage",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.realm.getUsage
  );

  // Tickets - 创建需要 Delegate Token
  realmRouter.post(
    "/:realmId/tickets",
    deps.delegateTokenMiddleware,
    deps.realmAccessMiddleware,
    zValidator("json", CreateTicketSchema),
    deps.tickets.create
  );
  realmRouter.get(
    "/:realmId/tickets",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.tickets.list
  );
  realmRouter.get(
    "/:realmId/tickets/:ticketId",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.tickets.get
  );
  realmRouter.post(
    "/:realmId/tickets/:ticketId/submit",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    zValidator("json", TicketSubmitSchema),
    deps.tickets.submit
  );

  // Nodes
  realmRouter.get(
    "/:realmId/nodes/:key",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.scopeValidationMiddleware,
    deps.chunks.get
  );
  realmRouter.put(
    "/:realmId/nodes/:key",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.canUploadMiddleware,
    deps.chunks.put
  );

  // Depots
  realmRouter.get(
    "/:realmId/depots",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.depots.list
  );
  realmRouter.post(
    "/:realmId/depots",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.canManageDepotMiddleware,
    zValidator("json", CreateDepotSchema),
    deps.depots.create
  );
  realmRouter.get(
    "/:realmId/depots/:depotId",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.depots.get
  );
  realmRouter.patch(
    "/:realmId/depots/:depotId",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.canManageDepotMiddleware,
    zValidator("json", UpdateDepotSchema),
    deps.depots.update
  );
  realmRouter.delete(
    "/:realmId/depots/:depotId",
    deps.accessTokenMiddleware,
    deps.realmAccessMiddleware,
    deps.canManageDepotMiddleware,
    deps.depots.delete
  );

  app.route("/api/realm", realmRouter);

  // ============================================================================
  // 404 Handler (保持)
  // ============================================================================
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
};
```

---

## 7. Schema 更新

### 7.1 新增 Schema 文件

**`schemas/token.ts`**：

```typescript
import { z } from "zod";

// Token 类型
export const TokenTypeSchema = z.enum(["delegate", "access"]);

// 创建 Delegate Token
export const CreateDelegateTokenSchema = z.object({
  realm: z.string().min(1),
  name: z.string().min(1).max(64),
  type: TokenTypeSchema,
  expiresIn: z.number().int().positive().optional(),
  canUpload: z.boolean().optional().default(false),
  canManageDepot: z.boolean().optional().default(false),
  scope: z.array(z.string()).min(1),
});

// Token 转签发
export const DelegateTokenSchema = z.object({
  type: TokenTypeSchema,
  expiresIn: z.number().int().positive().optional(),
  canUpload: z.boolean().optional(),
  canManageDepot: z.boolean().optional(),
  scope: z.array(z.string()).min(1),
});
```

**`schemas/token-request.ts`**：

```typescript
import { z } from "zod";
import { TokenTypeSchema } from "./token";

// 创建授权申请
export const CreateTokenRequestSchema = z.object({
  clientName: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
});

// 批准授权申请
export const ApproveTokenRequestSchema = z.object({
  realm: z.string().min(1),
  type: TokenTypeSchema,
  name: z.string().min(1).max(64),
  expiresIn: z.number().int().positive().optional(),
  canUpload: z.boolean().optional().default(false),
  canManageDepot: z.boolean().optional().default(false),
  scope: z.array(z.string()).min(1),
  clientSecret: z.string().length(26),  // Crockford Base32，26 字符
});
```

**`schemas/ticket.ts`** 更新：

```typescript
import { z } from "zod";

// 创建 Ticket（更新）
export const CreateTicketSchema = z.object({
  title: z.string().min(1).max(256),
  expiresIn: z.number().int().positive().optional(),
  canUpload: z.boolean().optional().default(false),
  scope: z.array(z.string()).optional(),
});

// Ticket 提交（新增）
export const TicketSubmitSchema = z.object({
  root: z.string().regex(/^node:[a-f0-9]+$/),
});
```

### 7.2 废弃 Schema

```typescript
// 废弃
ClientInitSchema      // AWP 客户端初始化
ClientCompleteSchema  // AWP 客户端完成
CreateTokenSchema     // 旧的 Token 创建（保留但重命名避免冲突）
TicketCommitSchema    // 改为 TicketSubmitSchema
```

### 7.3 Schema 导出更新

**`schemas/index.ts`**：

```typescript
// Token 相关 Schema
export {
  TokenTypeSchema,
  CreateDelegateTokenSchema,
  DelegateTokenSchema,
} from "./token";

// 授权申请 Schema
export {
  CreateTokenRequestSchema,
  ApproveTokenRequestSchema,
} from "./token-request";

// Ticket Schema
export {
  CreateTicketSchema,
  TicketSubmitSchema,
} from "./ticket";

// Depot Schema (保持)
export {
  CreateDepotSchema,
  UpdateDepotSchema,
  DepotCommitSchema,
} from "./depot";

// OAuth Schema (保持)
export {
  LoginSchema,
  RefreshSchema,
  TokenExchangeSchema,
} from "./oauth";

// Admin Schema (保持)
export { UpdateUserRoleSchema } from "./admin";

// 废弃的 Schema（标记但保留以避免破坏性变更）
/** @deprecated Use CreateDelegateTokenSchema instead */
export { CreateTokenSchema } from "./deprecated/token";
```

---

## 8. 实现步骤

### 8.1 Phase 1: Schema 准备

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 1.1 | 创建 Token Schema | `schemas/token.ts` | 低 |
| 1.2 | 创建 TokenRequest Schema | `schemas/token-request.ts` | 低 |
| 1.3 | 更新 Ticket Schema | `schemas/ticket.ts` | 低 |
| 1.4 | 更新 Schema 导出 | `schemas/index.ts` | 低 |

### 8.2 Phase 2: 路由结构重组

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 2.1 | 更新 RouterDeps 类型 | `router.ts` | 中 |
| 2.2 | 添加 Token 管理路由 | `router.ts` | 中 |
| 2.3 | 添加授权申请路由 | `router.ts` | 中 |
| 2.4 | 重构 Realm 路由 | `router.ts` | 高 |

### 8.3 Phase 3: 废弃路由处理

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 3.1 | 标记 AWP 路由废弃 | `router.ts` | 低 |
| 3.2 | 标记旧 Token 路由废弃 | `router.ts` | 低 |
| 3.3 | 移除废弃 Ticket 路由 | `router.ts` | 低 |

### 8.4 Phase 4: 验证与测试

| 步骤 | 任务 | 文件 | 复杂度 |
|------|------|------|--------|
| 4.1 | 路由单元测试 | `tests/router.test.ts` | 中 |
| 4.2 | Schema 验证测试 | `tests/schemas/*.test.ts` | 低 |
| 4.3 | 集成测试更新 | `e2e/*.test.ts` | 高 |

---

## 附录 A: CORS Header 更新

移除 AWP 相关 Header：

```typescript
// 旧配置
allowHeaders: [
  "Content-Type",
  "Authorization",
  "X-AWP-Pubkey",      // 移除
  "X-AWP-Timestamp",   // 移除
  "X-AWP-Signature",   // 移除
],

// 新配置
allowHeaders: [
  "Content-Type",
  "Authorization",
  "X-CAS-Index-Path",  // 新增：scope 验证
],
```

---

## 附录 B: 路由顺序注意事项

Hono 路由按注册顺序匹配，需要注意：

1. `/api/tokens/requests` 必须在 `/api/tokens/:tokenId` 之前
2. `/api/tokens/delegate` 必须在 `/api/tokens/:tokenId` 之前

```typescript
// 正确顺序
app.post("/api/tokens/requests", ...);           // 先匹配 requests
app.get("/api/tokens/requests/:requestId/poll", ...);
app.post("/api/tokens/delegate", ...);           // 再匹配 delegate
app.get("/api/tokens/:tokenId", ...);            // 最后匹配 :tokenId
```
