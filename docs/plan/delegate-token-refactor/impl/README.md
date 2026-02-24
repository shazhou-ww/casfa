# 实现规划文档

本目录包含 Delegate Token 重构的具体实现规划文档。

> 版本: 1.1  
> 日期: 2026-02-05  
> 更新: 修复 Ticket 可见性 bug，恢复 prepareNodes

---

## 文档索引

| 文档 | 内容 | 状态 |
|------|------|------|
| [01-dynamodb-changes.md](./01-dynamodb-changes.md) | DynamoDB 表结构变更与数据库操作层实现 | 完成 |
| [02-router-refactor.md](./02-router-refactor.md) | Router 路由重构规划 | 完成 |
| [03-middleware-refactor.md](./03-middleware-refactor.md) | Middleware 中间件重构规划 | 完成 |
| [04-controller-refactor.md](./04-controller-refactor.md) | Controller 控制器重构规划 | 完成 |
| [05-cleanup-and-summary.md](./05-cleanup-and-summary.md) | 废弃代码清理与实现总结 | 完成 |

### TODO 文档

| 文档 | 内容 | 优先级 |
|------|------|--------|
| [todo-quota-audit.md](./todo-quota-audit.md) | Quota 审计与管理功能 | 中 |

---

## 版本更新记录

### v1.1 (2026-02-05)

**严重 Bug 修复**：

1. **Ticket 可见性**：修正为使用 `creatorIssuerId` 而非 `creatorTokenId`
   - Access Token 不能创建 Ticket，只有 Delegate Token 可以
   - 与 Depot 可见性逻辑保持一致

2. **prepareNodes 不废弃**：恢复 `ChunksController.prepareNodes` 方法
   - 客户端批量上传前需要检查哪些节点已存在
   - 这是 CAS 上传流程的关键优化 API

**其他改进**：

- Rate Limiting 说明在 API Gateway 层配置而非代码层
- 抽取公共 Token 验证逻辑，减少代码重复
- 补充完整的 `verifyIndexPath` 实现
- 添加边界条件测试用例
- 级联撤销策略已确认（高级 Token 撤销是低频事件）

---

## 实现概览

### 主要变更

| 层级 | 新增 | 修改 | 废弃 |
|------|------|------|------|
| **数据库层** | 5 个新表/操作 | 2 个表扩展 | 5 个废弃操作 |
| **中间件层** | 5 个新中间件 | 2 个修改 | 3 个废弃 |
| **控制器层** | 2 个新控制器 | 4 个修改 | 2 个废弃 |
| **路由层** | 6 个新路由 | 12 个修改 | 7 个废弃 |

### 核心变更

1. **统一 Token 体系**：废弃 AWP/AgentToken/Ticket Token，统一为 Delegate Token
2. **认证中间件拆分**：从单一 `authMiddleware` 拆分为 `jwt/delegate/access` 三个专用中间件
3. **Issuer Chain 可见性**：Depot/Ticket 通过 Issuer Chain 控制可见性
4. **Scope 验证**：新增 `X-CAS-Index-Path` Header 验证节点访问权限

---

## 实现顺序

### Phase 1: 数据库层（已完成规划）

参见 [01-dynamodb-changes.md](./01-dynamodb-changes.md)

```
├── 类型定义 (types/delegate-token.ts)      ✓ 已存在
├── DelegateTokensDb                        ✓ 已存在
├── ScopeSetNodesDb                         ✓ 已存在
├── TicketsDb (重构)                        待实现
├── TokenRequestsDb                         ✓ 已存在
├── TokenAuditDb                            ✓ 已存在
├── DepotsDb (扩展)                         待实现
└── UserQuotaDb (新增)                      待实现
```

### Phase 2: 工具函数与服务层

参见 [04-controller-refactor.md](./04-controller-refactor.md) 第 6 节

```
├── util/token.ts                           待实现
├── util/token-request.ts                   待实现
├── util/scope.ts                           待实现
├── services/token.ts                       待实现
├── services/scope.ts                       待实现
└── services/encryption.ts                  待实现
```

### Phase 3: 中间件层

参见 [03-middleware-refactor.md](./03-middleware-refactor.md)

```
├── jwt-auth.ts                             待实现
├── delegate-token-auth.ts                  待实现
├── access-token-auth.ts                    待实现
├── scope-validation.ts                     待实现
├── permission-check.ts                     待实现
└── realm-access.ts (修改)                  待实现
```

### Phase 4: 控制器层

参见 [04-controller-refactor.md](./04-controller-refactor.md)

```
├── tokens.ts (新增)                        待实现
├── token-requests.ts (新增)                待实现
├── tickets.ts (重构)                       待实现
├── depots.ts (修改)                        待实现
├── chunks.ts (修改)                        待实现
└── realm.ts (修改)                         待实现
```

### Phase 5: 路由层

参见 [02-router-refactor.md](./02-router-refactor.md)

```
├── schemas/token.ts                        待实现
├── schemas/token-request.ts                待实现
├── schemas/ticket.ts (更新)                待实现
└── router.ts (重构)                        待实现
```

### Phase 6: 集成与清理

参见 [05-cleanup-and-summary.md](./05-cleanup-and-summary.md)

```
├── app.ts / bootstrap.ts 更新              待实现
├── 测试                                    待实现
└── 废弃代码清理                            待实现
```

---

## 依赖关系图

```
┌──────────────────────────────────────────────────────────────┐
│                      设计文档                                 │
│  ../01-delegate-token.md  ../05-data-model.md  ../07-api-*.md│
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              01-dynamodb-changes.md                          │
│              (数据库层实现)                                   │
└───────────────────────────┬──────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ 02-router-*.md │ │ 03-middleware- │ │ 04-controller- │
│ (路由重构)      │ │ *.md (中间件)  │ │ *.md (控制器)  │
└────────┬───────┘ └────────┬───────┘ └────────┬───────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              05-cleanup-and-summary.md                       │
│              (集成、测试、清理)                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 相关设计文档

| 文档 | 内容 |
|------|------|
| [../README.md](../README.md) | 重构概述与核心概念 |
| [../01-delegate-token.md](../01-delegate-token.md) | Delegate Token 二进制格式 |
| [../04-access-control.md](../04-access-control.md) | 访问控制规则 |
| [../05-data-model.md](../05-data-model.md) | 数据模型设计 |
| [../06-client-auth-flow.md](../06-client-auth-flow.md) | 客户端授权流程 |
| [../07-api-changes.md](../07-api-changes.md) | API 变更清单 |
| [../../casfa-api/README.md](../../casfa-api/README.md) | API 文档 |
