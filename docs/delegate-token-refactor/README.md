# Delegate Token 授权系统重构设计文档

> 版本: 1.0  
> 日期: 2026-02-05  
> 状态: 草案

---

## 目录

1. [重构动机](#1-重构动机)
2. [设计目标](#2-设计目标)
3. [架构概述](#3-架构概述)
4. [核心概念对照表](#4-核心概念对照表)
5. [文档索引](#5-文档索引)

---

## 1. 重构动机

### 1.1 现有架构问题

当前授权系统采用三层模型：

```
User → Clients/Token → Ticket
```

这种设计导致以下问题：

| 问题 | 描述 |
|------|------|
| **权限模型复杂** | 不同层级有不同的权限语义，API 需要处理多种认证类型 |
| **概念混淆** | Client、AgentToken、AWP Client 等概念重叠，职责边界模糊 |
| **Ticket 耦合过重** | Ticket 同时承担权限控制和工作空间管理两种职责 |
| **权限继承不清晰** | 跨层级的权限传递规则不一致 |
| **代码维护困难** | 认证中间件需要处理 4 种以上的身份类型 |

### 1.2 现有身份类型

当前系统支持的身份类型：

1. **User Token** - OAuth JWT 登录后生成
2. **Agent Token** - API 访问令牌（`casfa_xxx` 格式）
3. **AWP Client** - P-256 公钥认证
4. **Ticket** - 临时访问凭证，包含 scope 和 quota 限制

这些身份类型在权限模型上有不同的处理逻辑，增加了系统复杂度。

---

## 2. 设计目标

### 2.1 简化层级

将三层模型简化为两层：

```
User → Delegate
```

- **User**: 通过 OAuth JWT 证明身份，负责用户元信息管理和授权 Delegate
- **Delegate**: 通过 Delegate Token 证明身份，负责所有数据访问

### 2.2 统一权限模型

所有数据访问都通过 Delegate Token，权限模型统一为 6 个维度：

1. 授权 Realm（必选）
2. Token 类型（再授权 / 访问）
3. Depot 管理权限
4. 读权限 Scope
5. 写权限配额 Quota
6. 授权截止时间 TTL

### 2.3 职责分离

- **OAuth**: 仅负责用户身份认证和 Delegate 管理
- **Delegate Token**: 负责所有数据访问授权
- **Ticket**: 简化为工作空间概念（title + submit 状态），权限由关联的 Access Token 承载

### 2.4 可追溯性

- 记录所有 Token 的签发和撤销
- 支持 Issuer Chain 追溯
- Depot 归属可沿授权链向上追溯到用户

---

## 3. 架构概述

### 3.1 新授权模型

```
┌─────────────────────────────────────────────────────────────────┐
│                           User                                   │
│                    (OAuth JWT 身份认证)                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              │ 签发
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Delegate Token                               │
│              (128 字节二进制格式，客户端保管，服务端验证 ID)        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────┐     ┌─────────────────────┐           │
│   │   再授权 Token       │     │    访问 Token        │           │
│   │                     │     │                     │           │
│   │ - 不能访问数据       │     │ - 可以访问数据       │           │
│   │ - 可签发子 Token    │     │ - 不能签发 Token     │           │
│   │ - 较长生命周期       │     │ - 较短生命周期       │           │
│   └──────────┬──────────┘     └─────────────────────┘           │
│              │                                                   │
│              │ 转签发                                            │
│              ▼                                                   │
│   ┌─────────────────────┐                                       │
│   │   子 Delegate Token  │                                       │
│   │   (scope ⊆ 父 scope) │                                       │
│   └─────────────────────┘                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 数据访问流程

```
┌──────────┐    CAS URI + Token    ┌──────────┐
│  Client  │ ──────────────────────▶│  Server  │
└──────────┘                       └────┬─────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
              ┌──────────┐       ┌──────────┐       ┌──────────┐
              │ Token    │       │ Scope    │       │ Quota    │
              │ 有效性   │       │ 验证     │       │ 检查     │
              └──────────┘       └──────────┘       └──────────┘
                    │                   │                   │
                    │      验证通过      │                   │
                    └───────────────────┼───────────────────┘
                                        │
                                        ▼
                                  ┌──────────┐
                                  │ 数据访问  │
                                  └──────────┘
```

### 3.3 Issuer Chain

Depot 归属通过 Issuer Chain 验证：

```
User (user_hash)
  │
  ├── 签发 → 再授权 Token A (token_hash_a)
  │              │
  │              └── 转签发 → 访问 Token C (token_hash_c)
  │                              │
  │                              └── 创建 Depot X
  │
  └── 签发 → 访问 Token B (token_hash_b)
                  │
                  └── 创建 Depot Y
```

- Token B 可访问 Depot Y（直接创建者）
- Token B 可访问 Depot X（沿 chain: C → A → User，User 是 B 的签发者）
- Token C 只能访问 Depot X（自己创建的）
- Token C 不能访问 Depot Y（C 的 chain 不包含 B）

---

## 4. 核心概念对照表

### 4.1 术语对照

| 旧概念 | 新概念 | 说明 |
|--------|--------|------|
| User Token | OAuth JWT | 仅用于用户身份认证，不直接访问数据 |
| Agent Token | Delegate Token (再授权) | 统一为 Delegate Token，类型标记为再授权 |
| AWP Client | Delegate Token (再授权) | 废弃 P-256 认证，统一使用 Delegate Token |
| Ticket Token | Delegate Token (访问) | 统一为 Delegate Token，类型标记为访问 |
| Ticket | Ticket (工作空间) | 仅保留 title + submit 状态，权限移至 Token |
| scope (字符串数组) | scope (set-node hash) | 使用数据库存储的 set-node，带引用计数 |
| realm | realm | 保持不变，用户的数据隔离边界 |

### 4.2 权限对照

| 旧权限 | 新权限 | 映射方式 |
|--------|--------|----------|
| `canRead` | Token scope | scope 非空即可读 |
| `canWrite` | Token quota + flags | quota > 0 且 flags.canUpload |
| `canIssueTicket` | Token flags | flags.isDelegateToken |
| `canManageUsers` | OAuth 层面 | 不再属于 Delegate Token 范畴 |
| Ticket.commit | Token flags + Ticket.status | quota 保留，accept 暂废弃 |

### 4.3 数据结构对照

| 旧结构 | 新结构 | 变化 |
|--------|--------|------|
| Token (DB record) | DelegateToken (128 bytes) | 数据库只存 Token ID 和元数据，完整 Token 由客户端保管 |
| Ticket.scope (string[]) | Token.scope (32 bytes hash) | 使用 set-node |
| Depot | Depot + issuer | 增加创建者追踪 |
| - | CAS URI | 新增统一寻址格式 |

---

## 5. 文档索引

| 文档 | 内容 |
|------|------|
| [01-delegate-token.md](./01-delegate-token.md) | Delegate Token 权限模型与二进制编码规范 |
| [02-cas-uri.md](./02-cas-uri.md) | CAS URI 格式定义与解析规则 |
| [03-token-issuance.md](./03-token-issuance.md) | Token 签发与转签发流程 |
| [04-access-control.md](./04-access-control.md) | 访问鉴权规则 |
| [05-data-model.md](./05-data-model.md) | 数据模型变更与迁移方案 |

---

## 附录 A: 已确认事项

以下事项已在评审中确认：

1. **Magic Number**: `0x01544C44` = "DLT\x01"
2. **User ID Hash**: Blake3-256
3. **Token ID Hash**: Blake3-128
4. **Token ID 前缀**: `dlt1_`（全小写）
5. **Base32 编码**: Crockford Base32（排除 I, L, O, U）
6. **Token 深度限制**: 最大 15 层（flags bits 4-7）
7. **撤销策略**: 必须级联撤销
8. **Quota 字段**: Reserved，当前版本不启用
9. **set-node 存储**: 数据库独立表，带引用计数
10. **时间戳**: 服务端时间，不加相对偏移量
11. **迁移**: 系统未上线，直接替换无需兼容

---

## 附录 B: TODO（待后续补充）

以下章节计划在后续迭代中补充：

- [ ] 安全威胁模型
  - Token 泄露影响范围和应对措施
  - 中间人攻击防护（TLS 强制）
  - Token 存储最佳实践（客户端侧）
  - 暴力破解防护策略

- [ ] 监控与告警
  - Token 签发/撤销的关键指标
  - 异常行为检测
  - Quota 接近上限的告警

- [ ] API 版本控制
  - API 路径版本号
  - 破坏性变更通知机制
  - 旧版本 API 退役策略
