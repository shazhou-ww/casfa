# 废弃代码清理与实现总结

> 版本: 1.0  
> 日期: 2026-02-05  
> 基于: 02-router-refactor.md, 03-middleware-refactor.md, 04-controller-refactor.md

---

## 目录

1. [废弃代码清单](#1-废弃代码清单)
2. [文件迁移计划](#2-文件迁移计划)
3. [依赖更新](#3-依赖更新)
4. [实现顺序总结](#4-实现顺序总结)
5. [测试策略](#5-测试策略)
6. [回滚计划](#6-回滚计划)

---

## 1. 废弃代码清单

### 1.1 按模块分类

#### 数据库层 (db/)

| 文件 | 状态 | 说明 | 替代 |
|------|------|------|------|
| `awp-pending.ts` | 废弃 | AWP 待认证记录 | TokenRequestsDb |
| `awp-pubkeys.ts` | 废弃 | AWP 公钥存储 | 无 |
| `client-pending.ts` | 废弃 | Client 待认证 | TokenRequestsDb |
| `client-pubkeys.ts` | 废弃 | Client 公钥 | 无 |
| `tokens.ts` | 废弃 | 旧 Token 操作 | DelegateTokensDb |

#### 中间件层 (middleware/)

| 文件 | 状态 | 说明 | 替代 |
|------|------|------|------|
| `auth.ts` | 废弃 | 统一认证中间件 | jwt-auth.ts, delegate-token-auth.ts, access-token-auth.ts |
| `ticket-auth.ts` | 废弃 | Ticket 认证 | access-token-auth.ts + scope-validation.ts |

#### 控制器层 (controllers/)

| 文件 | 状态 | 说明 | 替代 |
|------|------|------|------|
| `auth-clients.ts` | 废弃 | AWP Client 管理 | 无 |
| `auth-tokens.ts` | 废弃 | 旧 Token 管理 | tokens.ts |
| `auth-tickets.ts` | 废弃 | 旧 Ticket 认证 | tickets.ts |
| `ticket.ts` | 废弃 | 单个 Ticket 控制器 | tickets.ts |

#### 类型 (types/)

| 类型 | 状态 | 说明 | 替代 |
|------|------|------|------|
| `UserToken` | 废弃 | OAuth Token 记录 | JWT 验证 |
| `AgentToken` | 废弃 | Agent Token | DelegateTokenRecord |
| `Ticket` (Token) | 废弃 | Ticket Token | AccessTokenRecord + TicketRecord |
| `AwpPendingAuth` | 废弃 | AWP 待认证 | TokenRequestRecord |
| `AwpPubkey` | 废弃 | AWP 公钥 | 无 |
| `ClientPendingAuth` | 废弃 | Client 待认证 | TokenRequestRecord |
| `ClientPubkey` | 废弃 | Client 公钥 | 无 |

#### Schema (schemas/)

| Schema | 状态 | 说明 | 替代 |
|--------|------|------|------|
| `ClientInitSchema` | 废弃 | AWP 初始化 | CreateTokenRequestSchema |
| `ClientCompleteSchema` | 废弃 | AWP 完成 | ApproveTokenRequestSchema |
| `CreateTokenSchema` | 重命名 | 旧 Token 创建 | CreateDelegateTokenSchema |
| `TicketCommitSchema` | 废弃 | Ticket 提交 | TicketSubmitSchema |

> **注意**：以下方法 **不废弃**：
> - `ChunksController.prepareNodes` - 上传前检查节点存在性，客户端批量上传优化必需
> - `ChunksController.getMetadata` - 获取节点元信息

### 1.2 废弃函数清单

```typescript
// db/awp-pending.ts
export const createAwpPendingDb = (...) => {...}  // 废弃

// db/awp-pubkeys.ts
export const createAwpPubkeysDb = (...) => {...}  // 废弃

// db/client-pending.ts
export const createClientPendingDb = (...) => {...}  // 废弃

// db/client-pubkeys.ts
export const createClientPubkeysDb = (...) => {...}  // 废弃

// db/tokens.ts
export const createTokensDb = (...) => {...}  // 废弃

// middleware/auth.ts
export const createAuthMiddleware = (...) => {...}  // 废弃
export const createOptionalAuthMiddleware = (...) => {...}  // 废弃

// middleware/ticket-auth.ts
export const createTicketAuthMiddleware = (...) => {...}  // 废弃
export const checkTicketReadAccess = (...) => {...}  // 废弃
export const checkTicketWriteQuota = (...) => {...}  // 废弃

// controllers/auth-clients.ts
export const createAuthClientsController = (...) => {...}  // 废弃

// controllers/auth-tokens.ts
export const createAuthTokensController = (...) => {...}  // 废弃

// util/client-id.ts
export const computeClientId = (...) => {...}  // 废弃（AWP 专用）
```

---

## 2. 文件迁移计划

### 2.1 目录结构变更

```
apps/server/backend/src/
├── db/
│   ├── deprecated/                    # 废弃文件归档
│   │   ├── awp-pending.ts
│   │   ├── awp-pubkeys.ts
│   │   ├── client-pending.ts
│   │   ├── client-pubkeys.ts
│   │   └── tokens.ts
│   ├── client.ts                      # 保持
│   ├── delegate-tokens.ts             # 新增（已存在）
│   ├── depots.ts                      # 修改
│   ├── index.ts                       # 更新导出
│   ├── ownership.ts                   # 保持
│   ├── refcount.ts                    # 保持
│   ├── scope-set-nodes.ts             # 新增（已存在）
│   ├── tickets.ts                     # 新增/修改
│   ├── token-audit.ts                 # 新增（已存在）
│   ├── token-requests.ts              # 新增（已存在）
│   ├── usage.ts                       # 扩展
│   └── user-roles.ts                  # 保持
│
├── middleware/
│   ├── deprecated/                    # 废弃文件归档
│   │   ├── auth.ts
│   │   └── ticket-auth.ts
│   ├── index.ts                       # 更新导出
│   ├── jwt-auth.ts                    # 新增
│   ├── delegate-token-auth.ts         # 新增
│   ├── access-token-auth.ts           # 新增
│   ├── scope-validation.ts            # 新增
│   ├── permission-check.ts            # 新增
│   └── realm-access.ts                # 修改
│
├── controllers/
│   ├── deprecated/                    # 废弃文件归档
│   │   ├── auth-clients.ts
│   │   ├── auth-tokens.ts
│   │   ├── auth-tickets.ts
│   │   └── ticket.ts
│   ├── index.ts                       # 更新导出
│   ├── tokens.ts                      # 新增
│   ├── token-requests.ts              # 新增
│   ├── tickets.ts                     # 重构
│   ├── depots.ts                      # 修改
│   ├── chunks.ts                      # 修改
│   ├── realm.ts                       # 修改
│   ├── oauth.ts                       # 保持
│   ├── admin.ts                       # 保持
│   ├── health.ts                      # 保持
│   └── info.ts                        # 保持
│
├── services/
│   ├── index.ts                       # 更新导出
│   ├── token.ts                       # 新增
│   ├── scope.ts                       # 新增
│   ├── encryption.ts                  # 新增
│   └── auth.ts                        # 修改
│
├── schemas/
│   ├── deprecated/                    # 废弃 Schema
│   │   └── client.ts
│   ├── index.ts                       # 更新导出
│   ├── token.ts                       # 新增
│   ├── token-request.ts               # 新增
│   ├── ticket.ts                      # 修改
│   └── depot.ts                       # 保持
│
├── types/
│   ├── index.ts                       # 更新导出
│   └── delegate-token.ts              # 已存在
│
├── util/
│   ├── index.ts                       # 更新导出
│   ├── token.ts                       # 新增
│   ├── token-request.ts               # 新增
│   ├── scope.ts                       # 新增
│   └── ...                            # 保持
│
├── router.ts                          # 重构
├── types.ts                           # 重构
├── app.ts                             # 更新依赖
└── bootstrap.ts                       # 更新依赖
```

### 2.2 迁移脚本

```bash
#!/bin/bash
# scripts/migrate-to-deprecated.sh

cd apps/server/backend/src

# 创建 deprecated 目录
mkdir -p db/deprecated
mkdir -p middleware/deprecated
mkdir -p controllers/deprecated
mkdir -p schemas/deprecated

# 移动废弃的数据库文件
mv db/awp-pending.ts db/deprecated/
mv db/awp-pubkeys.ts db/deprecated/
mv db/client-pending.ts db/deprecated/
mv db/client-pubkeys.ts db/deprecated/
mv db/tokens.ts db/deprecated/

# 移动废弃的中间件文件
mv middleware/auth.ts middleware/deprecated/
mv middleware/ticket-auth.ts middleware/deprecated/

# 移动废弃的控制器文件
mv controllers/auth-clients.ts controllers/deprecated/
mv controllers/auth-tokens.ts controllers/deprecated/
mv controllers/auth-tickets.ts controllers/deprecated/
mv controllers/ticket.ts controllers/deprecated/

echo "Migration complete. Update index.ts files to reflect changes."
```

---

## 3. 依赖更新

### 3.1 新增依赖

无需新增外部依赖，所有功能使用现有依赖实现：

| 功能 | 使用的依赖 | 说明 |
|------|-----------|------|
| Blake3 Hash | `@noble/hashes` | 已有依赖 |
| AES-256-GCM | `node:crypto` | Node.js 内置 |
| Base32 编码 | 自定义实现 | `util/encoding.ts` |
| ULID 生成 | 自定义实现 | `util/id.ts` |

### 3.2 移除的依赖引用

```typescript
// app.ts / bootstrap.ts 中移除的导入

// 废弃的数据库
import { createAwpPendingDb } from "./db/awp-pending";      // 移除
import { createAwpPubkeysDb } from "./db/awp-pubkeys";      // 移除
import { createClientPendingDb } from "./db/client-pending"; // 移除
import { createClientPubkeysDb } from "./db/client-pubkeys"; // 移除
import { createTokensDb } from "./db/tokens";                // 移除

// 废弃的中间件
import { createAuthMiddleware } from "./middleware/auth";    // 移除
import { createTicketAuthMiddleware } from "./middleware/ticket-auth"; // 移除

// 废弃的控制器
import { createAuthClientsController } from "./controllers/auth-clients"; // 移除
import { createAuthTokensController } from "./controllers/auth-tokens";   // 移除
```

### 3.3 新增依赖引用

```typescript
// app.ts / bootstrap.ts 中新增的导入

// 新数据库
import { createDelegateTokensDb } from "./db/delegate-tokens";
import { createScopeSetNodesDb } from "./db/scope-set-nodes";
import { createTicketsDb } from "./db/tickets";
import { createTokenRequestsDb } from "./db/token-requests";
import { createTokenAuditDb } from "./db/token-audit";

// 新中间件
import { createJwtAuthMiddleware } from "./middleware/jwt-auth";
import { createDelegateTokenMiddleware } from "./middleware/delegate-token-auth";
import { createAccessTokenMiddleware } from "./middleware/access-token-auth";
import { createScopeValidationMiddleware } from "./middleware/scope-validation";
import { createCanUploadMiddleware, createCanManageDepotMiddleware } from "./middleware/permission-check";

// 新控制器
import { createTokensController } from "./controllers/tokens";
import { createTokenRequestsController } from "./controllers/token-requests";

// 新服务
import { createTokenService } from "./services/token";
import { createScopeService } from "./services/scope";
```

---

## 4. 实现顺序总结

### 4.1 完整实现路线图

```
Phase 0: 准备工作 (已完成)
├── 01-dynamodb-changes.md        ✓
└── 类型定义 (delegate-token.ts)  ✓

Phase 1: 数据库层
├── scope-set-nodes.ts            ✓
├── delegate-tokens.ts            ✓
├── tickets.ts (重构)             待实现
├── token-requests.ts             ✓
├── token-audit.ts                ✓
├── depots.ts (修改)              待实现
└── usage.ts (扩展 UserQuota)     待实现

Phase 2: 工具函数与服务
├── util/token.ts                 待实现
├── util/token-request.ts         待实现
├── util/scope.ts                 待实现
├── services/token.ts             待实现
├── services/scope.ts             待实现
└── services/encryption.ts        待实现

Phase 3: 中间件
├── jwt-auth.ts                   待实现
├── delegate-token-auth.ts        待实现
├── access-token-auth.ts          待实现
├── scope-validation.ts           待实现
├── permission-check.ts           待实现
└── realm-access.ts (修改)        待实现

Phase 4: 控制器
├── tokens.ts                     待实现
├── token-requests.ts             待实现
├── tickets.ts (重构)             待实现
├── depots.ts (修改)              待实现
├── chunks.ts (修改)              待实现
└── realm.ts (修改)               待实现

Phase 5: Schema 与路由
├── schemas/token.ts              待实现
├── schemas/token-request.ts      待实现
├── schemas/ticket.ts (更新)      待实现
└── router.ts (重构)              待实现

Phase 6: 集成与测试
├── app.ts / bootstrap.ts 更新    待实现
├── 单元测试                      待实现
├── 集成测试                      待实现
└── E2E 测试                      待实现

Phase 7: 清理
├── 移动废弃文件到 deprecated/    待实现
├── 更新所有 index.ts 导出        待实现
└── 移除未使用的导入              待实现
```

### 4.2 依赖关系图

```
                    ┌──────────────────┐
                    │  Type Definitions │
                    │ (delegate-token)  │
                    └────────┬─────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌────────────┐   ┌────────────┐    ┌────────────┐
    │    DB      │   │   Utils    │    │  Services  │
    │   Layer    │   │            │    │            │
    └─────┬──────┘   └─────┬──────┘    └─────┬──────┘
          │                │                 │
          └────────────────┼─────────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │ Middleware │
                    └─────┬──────┘
                          │
                          ▼
                    ┌────────────┐
                    │ Controller │
                    └─────┬──────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
           ▼              ▼              ▼
     ┌──────────┐  ┌────────────┐  ┌──────────┐
     │  Schema  │  │   Router   │  │   App    │
     └──────────┘  └────────────┘  └──────────┘
```

### 4.3 建议实现批次

**批次 1：核心基础设施**

1. `util/token.ts` - Token 生成和解码
2. `util/scope.ts` - Scope 验证
3. `services/token.ts` - Token 服务封装
4. `services/scope.ts` - Scope 服务封装

**批次 2：认证中间件**

1. `middleware/jwt-auth.ts`
2. `middleware/delegate-token-auth.ts`
3. `middleware/access-token-auth.ts`

**批次 3：授权中间件**

1. `middleware/scope-validation.ts`
2. `middleware/permission-check.ts`
3. `middleware/realm-access.ts` (更新)

**批次 4：控制器实现**

1. `controllers/tokens.ts`
2. `controllers/token-requests.ts`
3. `controllers/tickets.ts` (重构)

**批次 5：控制器修改**

1. `controllers/depots.ts`
2. `controllers/chunks.ts`
3. `controllers/realm.ts`

**批次 6：Schema 与路由**

1. `schemas/token.ts`
2. `schemas/token-request.ts`
3. `schemas/ticket.ts` (更新)
4. `router.ts` (重构)

**批次 7：集成**

1. `app.ts` / `bootstrap.ts` 更新
2. 测试
3. 清理

---

## 5. 测试策略

### 5.1 单元测试覆盖

| 模块 | 测试文件 | 关键测试点 |
|------|----------|-----------|
| Token 工具 | `util/token.test.ts` | Token 生成、解码、ID 计算 |
| Scope 工具 | `util/scope.test.ts` | Index path 验证、相对路径解析 |
| JWT 中间件 | `middleware/jwt-auth.test.ts` | 验证成功/失败、过期处理 |
| Token 中间件 | `middleware/token-auth.test.ts` | Delegate/Access 区分、撤销检测 |
| Tokens 控制器 | `controllers/tokens.test.ts` | CRUD、转签发约束、级联撤销 |
| TokenRequests 控制器 | `controllers/token-requests.test.ts` | 流程状态机、加密解密 |
| Tickets 控制器 | `controllers/tickets.test.ts` | 创建、可见性、提交 |

### 5.2 集成测试场景

| 场景 | 说明 |
|------|------|
| Token 完整生命周期 | 创建 → 转签发 → 使用 → 撤销 |
| 客户端授权流程 | 申请 → 轮询 → 批准 → 获取 Token |
| Ticket 工作流 | 创建 → 读写 Node → 提交 → Access Token 撤销 |
| Issuer Chain 可见性 | 多层 Token 的 Depot/Ticket 可见性 |
| Scope 验证 | Index path 验证通过/拒绝 |
| 级联撤销 | 父 Token 撤销后子 Token 无效 |

### 5.3 边界条件测试

| 边界条件 | 测试场景 | 预期行为 |
|----------|----------|----------|
| **Token 过期边界** | Token 在请求处理中间过期 | 返回 401 TOKEN_EXPIRED |
| **TTL 边界** | 请求 TTL 恰好等于父 Token 剩余时间 | 允许创建 |
| **TTL 超限** | 请求 TTL 超过父 Token 剩余时间 1ms | 拒绝，返回 INVALID_TTL |
| **Depth 边界** | depth=15 的 Token 尝试转签发 | 拒绝，返回 MAX_DEPTH_EXCEEDED |
| **Scope 边界** | 请求恰好在 scope 边界的节点 | 通过验证 |
| **Index Path 越界** | rootIndex 超出 scopeRoots 长度 | 拒绝，返回 NODE_NOT_IN_SCOPE |
| **空 Scope** | Token scope 为空集 | 拒绝所有节点访问 |
| **Issuer Chain 边界** | depth=15 时 issuerChain 长度验证 | 正确包含所有祖先 |
| **并发级联撤销** | 同时撤销多个相关 Token | 事务一致性保证 |
| **Token 请求超时** | 请求恰好在 10 分钟过期时轮询 | 返回 expired 状态 |
| **重复撤销** | 对已撤销的 Token 再次撤销 | 返回 409 TOKEN_REVOKED |
| **空数组 prepareNodes** | 传入空 keys 数组 | 返回 400 错误 |
| **大批量 prepareNodes** | 传入超过 1000 个 keys | 返回 400 错误，提示限制 |
| **Unicode 名称** | Token/Ticket 名称包含 emoji/中文 | 正确存储和返回 |
| **Ticket 重复提交** | 对已提交的 Ticket 再次提交 | 返回 409 CONFLICT |

### 5.3 E2E 测试

```typescript
// e2e/delegate-token-flow.test.ts

describe("Delegate Token Flow", () => {
  it("should complete full token lifecycle", async () => {
    // 1. 用户登录获取 JWT
    const jwt = await login(testUser);

    // 2. 创建 Delegate Token
    const token = await createToken(jwt, {
      realm: userRealm,
      name: "Test Token",
      type: "delegate",
      scope: ["cas://depot:MAIN"],
    });

    // 3. 转签发 Access Token
    const accessToken = await delegateToken(token.tokenBase64, {
      type: "access",
      scope: [".:0"],
    });

    // 4. 使用 Access Token 读写数据
    const node = await putNode(accessToken.tokenBase64, testData);
    const retrieved = await getNode(accessToken.tokenBase64, node.key, "0");
    expect(retrieved).toEqual(testData);

    // 5. 撤销 Token
    const result = await revokeToken(jwt, token.tokenId);
    expect(result.revokedCount).toBe(2); // Parent + child

    // 6. 验证 Access Token 已失效
    await expect(getNode(accessToken.tokenBase64, node.key, "0"))
      .rejects.toThrow("TOKEN_REVOKED");
  });
});
```

---

## 6. 回滚计划

### 6.1 回滚策略

由于系统尚未上线，采用**代码级回滚**策略：

1. **Git 分支管理**：所有变更在 feature 分支进行
2. **阶段性合并**：每个批次完成并测试通过后合并
3. **废弃代码保留**：废弃文件移至 `deprecated/` 而非删除

### 6.2 回滚触发条件

| 条件 | 回滚范围 | 操作 |
|------|----------|------|
| 单元测试失败 | 当前批次 | 修复或回滚当前批次 |
| 集成测试失败 | 相关批次 | 回滚受影响的批次 |
| E2E 测试失败 | 完整功能 | 评估后决定部分或完整回滚 |
| 生产事故 | - | 不适用（未上线） |

### 6.3 回滚步骤

```bash
# 1. 确定需要回滚的提交
git log --oneline

# 2. 创建回滚分支
git checkout -b rollback/delegate-token

# 3. 回滚到指定提交
git revert <commit-hash>

# 4. 验证测试通过
bun test

# 5. 合并回滚分支
git checkout main
git merge rollback/delegate-token
```

---

## 附录 A: 检查清单

### A.1 实现完成检查

- [ ] 所有新类型定义完成
- [ ] 所有数据库层实现完成
- [ ] 所有中间件实现完成
- [ ] 所有控制器实现完成
- [ ] 所有 Schema 定义完成
- [ ] Router 重构完成
- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 所有 E2E 测试通过

### A.2 清理检查

- [ ] 废弃文件已移至 `deprecated/`
- [ ] 所有 `index.ts` 导出已更新
- [ ] 未使用的导入已移除
- [ ] CORS Header 已更新
- [ ] API 文档已更新

### A.3 文档检查

- [ ] README 更新
- [ ] API 文档与实现一致
- [ ] 错误码文档完整
- [ ] 类型定义有 JSDoc 注释

---

## 附录 B: 相关文档索引

| 文档 | 内容 |
|------|------|
| [01-dynamodb-changes.md](./01-dynamodb-changes.md) | DynamoDB 表结构变更 |
| [02-router-refactor.md](./02-router-refactor.md) | Router 路由重构 |
| [03-middleware-refactor.md](./03-middleware-refactor.md) | Middleware 中间件重构 |
| [04-controller-refactor.md](./04-controller-refactor.md) | Controller 控制器重构 |
| [../07-api-changes.md](../07-api-changes.md) | API 变更清单 |
| [../05-data-model.md](../05-data-model.md) | 数据模型设计 |
| [../04-access-control.md](../04-access-control.md) | 访问控制规则 |
| [../../casfa-api/README.md](../../casfa-api/README.md) | API 文档 |
