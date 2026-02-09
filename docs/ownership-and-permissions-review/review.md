# v3.1 权限方案评审报告

> 评审日期: 2026-02-09
> 评审对象: `ownership-and-permissions.md` (v3.4, 2026-02-09)
> 对比基线: `delegate-token-refactor/` (v1.0, 2026-02-05)

---

## 目录

1. [架构层面的重大改进](#1-架构层面的重大改进)
2. [安全模型的改进](#2-安全模型的改进)
3. [需要关注的问题和风险](#3-需要关注的问题和风险)
4. [文档质量和完整性评审](#4-文档质量和完整性评审)
5. [具体修改建议汇总](#5-具体修改建议汇总)
6. [总体评价](#6-总体评价)

---

## 1. 架构层面的重大改进

### 1.1 Delegate 实体化 — 核心突破 ✅

v1.0 中 **Token 即身份**（Delegation Token + Access Token 二元模型），v3.1 将 **Delegate 提升为一等业务实体**，与 Token 分离。这是最重要的架构升级：

| 维度 | v1.0 | v3.1 | 评价 |
|------|------|------|------|
| 身份主体 | Token | Delegate | ✅ 正确——Token 是凭证，不应承载身份 |
| Ownership 主体 | Token issuer chain | Delegate | ✅ 更稳定——Token 过期不影响 ownership |
| 树结构 | Issuer Chain（Token 之间的签发链） | Delegate Tree（immutable） | ✅ 不可变树更安全 |
| 生命周期 | Token 过期即消失（DynamoDB TTL 自动删除） | Delegate 永久保留，可 revoke | ✅ 历史可追溯 |

**评审意见**：这个改动解决了 v1.0 最大的设计缺陷——Token 过期后 ownership 追溯断裂的问题。在 v1.0 中，如果 issuer chain 上某个 Token 过期被 GC，整条追溯链就断了。v3.1 的 Delegate 永久存储从根本上解决了这个问题。**强烈认可**。

### 1.2 Refresh Token + Access Token 替代 Delegation Token + Access Token ✅

v1.0 的 "再授权 Token"（Delegation Token）可签发子 Token 但不能访问数据，Access Token 可访问数据但不能签发。v3.1 改为经典的 **Refresh Token（续期）+ Access Token（统一操作）**模型。

**评审意见**：好改动。v1.0 的设计中，Agent 必须同时持有两个 Token（一个 Delegation Token 用于签发，一个 Access Token 用于数据操作），增加了客户端复杂度。v3.1 中 Access Token 可以同时做数据操作和创建子 delegate，大幅简化了客户端逻辑。

### 1.3 Ticket 概念的移除 ✅

v1.0 保留了简化版 Ticket 作为"工作空间"概念；v3.1 完全移除了 Ticket，工具调用直接通过创建带 `expiresAt` 的子 Delegate 实现（原文 §8.7）。

**评审意见**：正确的简化。Ticket 在 v1.0 中既不是 Token 也不是 Delegate，是一个尴尬的中间概念。v3.1 用 "短期子 delegate + AT" 完全替代了 Ticket 的功能，概念更统一。

---

## 2. 安全模型的改进

### 2.1 Revoke 不级联写入，验证时级联生效 ✅

v1.0 要求 **revoke 必须级联撤销所有子 Token**（递归遍历写入）；v3.1 只标记目标 delegate，验证时检查整条 chain。

**评审意见**：显著改进。v1.0 的级联 revoke 有事务一致性问题（子 Token 可能成千上万，DynamoDB TransactWriteItems 限 100 条），v3.1 的"延迟验证"模式完全避免了这个问题。但 **需注意一个 trade-off**——见下文 §3.1。

### 2.2 Ownership 全链写入 ✅

v1.0 通过 Token issuer chain 追溯 ownership，没有独立的 Ownership 记录；v3.2 引入了独立的 Ownership 记录（`OWN#{nodeHash}`），采用**全链写入**模式——上传 Node 时为 chain 上每个 delegate 都写入一条记录，查询时 O(1) `GetItem` 直接命中。

**评审意见**：正确设计。查询是热路径，写入是冷路径，用全链写入换取 O(1) 查询是正确的 trade-off。

### 2.3 Claim API（Proof-of-Possession）✅

v1.0 没有 Claim 概念，unowned 节点只能重传。v3.1 引入了 Proof-of-Possession 机制，通过证明持有完整内容获取 ownership，无需重传数据。

**评审意见**：有价值的优化，避免大文件重传。但 **PoP 的 sampling 函数未定义是一个重大阻塞项**——见下文 §3.3。

---

## 3. 需要关注的问题和风险

### 3.1 ✅ ~~P0: Delegate Chain 验证性能~~ → 已解决

**位置**：原文 §5.1

**解决方案**：采用 Redis 缓存 delegate revoke/过期状态。每个 delegate 的状态缓存在 `dlg:revoked:{delegateId}` key 中，TTL 与 AT 有效期对齐。Revoke 时主动写入 Redis，缓存未命中时回查 DynamoDB。无 Redis 时 fallback 到 `BatchGetItem`。已更新到文档 §5.1。

### 3.2 ✅ ~~P0: Ownership 查询性能~~ → 已解决

**位置**：原文 §4.2-4.4

**解决方案**：采用全链写入模式——上传 Node 时为 chain 上每个 delegate 各写入一条 ownership 记录（`PK=OWN#{nodeHash}, SK={delegateId}`）。查询变为 O(1) `GetItem`，不再需要遍历所有 owner 的 chain。Chain 深度通常 2-4 层，`BatchWriteItem` 写入开销可控。已更新到文档 §4.2-4.5、§8.1-8.7、§9.1-9.4。

### 3.3 ✅ ~~P0: Sampling 函数未定义~~ → 已解决

**位置**：原文 §6.3

**解决方案**：采用 Keyed Blake3 方案——`blake3_128(key=blake3_256(token_bytes), msg=content)`。直接对完整内容做 keyed hash，无需自定义采样策略。Blake3 流式处理任意大小内容，无采样碰撞风险，安全性最强。已更新到文档 §6.2-6.5，包含完整的 TypeScript 示例代码。

### 3.4 ✅ ~~P1: `is_root` Flag 安全性~~ → 已解决

**位置**：原文 §3.4

**解决方案**：从 Token 二进制格式中移除了 `is_root` 标志位。Root delegate 的判断完全由服务端查询 delegate 记录决定（`depth == 0 && parentId == null`），不依赖 Token 中的任何标志位。这消除了客户端伪造 `is_root` bit 的提权风险。Flags 位已重新编号：0=is_refresh, 1=can_upload, 2=can_manage_depot, 3-6=depth。已更新到文档 §3.4、§5.1、§7.3、§9.4。

### 3.5 ✅ ~~P1: FS 操作的 Proof 策略未定~~ → 已解决

**位置**：原文 §7.2

**解决方案**：明确了 FS 操作的鉴权模型**基于 Node 节点**而非 Depot。所有 FS 写操作（write, mkdir, rm, mv, cp）的本质是对现有 Node 变换生成新 Node，新 Node 由执行操作的 delegate 获得 ownership，因此**不需要 proof**。只有 **rewrite**（link 引用）和 **mount** 这样能引入外部节点的操作，需要对引入节点做 proof（ownership、ipath 或 PoP）。FS 读操作在 Depot 上下文中通过 Depot 管理权限隐式授权。已更新到文档 §7.2、§9.1、§9.4。

### 3.6 ✅ ~~P1: ScopeSetNode 引用计数生命周期~~ → 已解决

**位置**：原文 §9.3

**解决方案**：澄清了引用计数的语义——ScopeSetNode 本身不持有 `refCount`，但创建 ScopeSetNode 时会增加其 children（scope root hash）的引用计数。Delegate 在 TTL 有效期内，其 scope 持有的引用计数有效（保护 scope root 不被 GC）；Delegate 过期或被 revoke 后，引用计数可安全回收。已从数据模型中移除了 ScopeSetNode 的 `refCount` 字段。已更新到文档 §9.3。

### 3.7 ✅ ~~P1: Depot Commit 是否支持 Proof~~ → 已解决

**位置**：原文 §5.5.4

**解决方案**：支持 proof 作为 ownership 的 fallback。Depot commit 验证流程为：(1) 检查 Depot 管理权限，(2) 检查 root 节点 ownership，(3) 无 ownership 则检查 `X-CAS-Proof` 中的 proof，(4) 都没有则 403。这使得 delegate 可以 commit 通过 scope 可见但没有 ownership 的 root 节点。已更新到文档 §5.5.4、§7.2。

### 3.8 ✅ ~~P2: `managedDepots` 可维护性~~ → 已解决

**位置**：原文 §2.3

**解决方案**：重命名为 `delegatedDepots`，明确语义为“父 delegate 显式委派的 Depot 列表”。自己和子孙创建的 Depot 是隐式获得的管理权限，不存储在 delegate 记录中。这样 `delegatedDepots` 的 immutable 语义就准确了——它仅代表父节点授权的部分，不会因为后续创建新 Depot 而需要变更。已更新到文档 §2.3、§2.6、§3.6、§5.5.4、§8.1、§9.1、§9.3、§9.4。

### 3.9 ✅ ~~P2: Token 二进制格式补充~~ → 已解决

**位置**：原文 §3.4

**解决方案**：已补充完整的 Flags 组合示例表、5 种典型场景的 flags 值）、Issuer 字段编码规则（UUID v7 left-padded to 32B）、Scope 字段编码规则（root 全零、单 scope、多 scope）、以及完整的 TypeScript 编码/解码示例代码。已更新到文档 §3.4。

---

## 4. 文档质量和完整性评审

### 4.1 优点

- ✅ 文档结构清晰，从核心概念 → 模型 → 流程 → 安全总结，逐步递进
- ✅ 大量端到端流程示例（原文 §8），覆盖了主要场景
- ✅ 安全性设计小结（原文 §9）做了攻击场景-防御映射，思路完整
- ✅ 数据模型一览（原文 §9.3）提供了 DynamoDB schema 概览
- ✅ 关键不变量列表（原文 §9.4）明确了 13 条系统约束，便于实现时对照

### 4.2 缺失内容

| 编号 | 缺失项 | 说明 | 优先级 |
|------|--------|------|--------|
| D1 | **Client Auth Flow** | v1.0 有详细的客户端授权申请流程，包括 clientSecret、displayCode、轮询机制。**已确认保持不变，不需要在本文档中重复描述** | ✅ 已解决 |
| D2 | **Token 二进制格式详细规范** | 已补充完整的 Flags 组合示例、Issuer/Scope 编码规则、TypeScript 编解码示例 | ✅ 已解决 |
| D3 | **迁移方案** | 无需数据迁移。实现新版的分步落地方案将作为单独文档，本文档只讨论目标架构 | ✅ 不适用 |
| D4 | **错误码汇总** | 已补充系统化的 HTTP 状态码约定和业务错误码定义（新增 §10） | ✅ 已解决 |
| D5 | **Quota 机制** | Token 格式中保留了 quota 字段，后续启用时再详细定义 | 🟢 保留 |

---

## 5. 具体修改建议汇总

| 优先级 | 编号 | 问题 | 建议 | 对应原文位置 | 状态 |
|--------|------|------|------|-------------|------|
| ✅ | I1 | Delegate chain 验证性能 | Redis 缓存 delegate revoke 状态，无 Redis 时 fallback 到 BatchGetItem | §5.1 | **已解决** |
| ✅ | I2 | Ownership 查询性能 | 全链写入（写 N 条），查询 O(1) GetItem | §4.2-4.5 | **已解决** |
| ✅ | I3 | Sampling 函数未定义 | Keyed Blake3: `blake3_128(key=blake3_256(token), msg=content)` | §6.3 | **已解决** |
| ✅ | I4 | `is_root` flag 安全性 | 从 Token 中移除 `is_root` 标志，服务端通过 DB 记录判断 root 身份 | §3.4 | **已解决** |
| ✅ | I5 | FS 操作 proof 策略 | FS 鉴权基于 Node；常规写操作生成新 Node 无需 proof；rewrite/mount 引入外部节点需 proof | §7.2 | **已解决** |
| ✅ | I6 | ScopeSetNode refCount | ScopeSetNode 不持有 refCount，创建时增加 children 的 refCount；Delegate TTL 驱动引用生命周期 | §9.3 | **已解决** |
| ✅ | I7 | Depot commit proof 支持 | 支持 proof 作为 ownership 的 fallback | §5.5.4 | **已解决** |
| ✅ | D1 | Client Auth Flow | 保持不变，不需要在本文档中补充 | — | **已解决** |
| ✅ | I8 | `managedDepots` 重命名 | 重命名为 `delegatedDepots`，明确为“父 delegate 显式委派的 Depot”，自建 Depot 为隐式权限 | §2.3 | **已解决** |
| ✅ | I9 | Token 二进制格式详细规范 | 补充 Flags 组合示例、Issuer/Scope 编码规则、编解码代码 | §3.4 | **已解决** |
| ✅ | D2 | 错误码汇总 | 新增 §10 错误码定义（HTTP 状态码 + 业务错误码） | §10 | **已解决** |
| ✅ | D3 | 迁移/落地方案 | 不适用——本文档只讨论目标架构，分步落地方案将作为单独文档 | — | **不适用** |

---

## 6. 总体评价

### 评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | ⭐⭐⭐⭐⭐ | Delegate 实体化是正确的核心决策，彻底解决了 v1.0 的 ownership 追溯断裂问题 |
| **安全模型** | ⭐⭐⭐⭐⭐ | Revoke 延迟验证、Keyed Blake3 PoP Claim、双 Header 授权设计扎实 |
| **可实现性** | ⭐⭐⭐⭐⭐ | P0 性能问题已解决（Redis 缓存 + 全链写入 + Keyed Blake3） |
| **文档完整性** | ⭐⭐⭐⭐⭐ | P0/P1/P2 全部解决，包含 Token 编解码规范、错误码表、完整的数据模型 |
| **与 v1.0 对比** | ⭐⭐⭐⭐⭐ | 全面优于 v1.0，解决了 v1.0 的主要架构缺陷，概念更统一 |

### 结论

**v3.4 是对 v1.0 的一次成功的架构升级**。核心改进包括 Delegate 实体化、Refresh Token 轮转机制和 Claim API。

**所有 P0 级问题已解决**：

1. ✅ **I1** — Delegate chain 验证性能 → Redis 缓存
2. ✅ **I2** — Ownership 查询性能 → 全链写入 + O(1) GetItem
3. ✅ **I3** — PoP 算法未定义 → Keyed Blake3

**所有 P1 级问题已解决**：

4. ✅ **I4** — `is_root` flag 安全性 → 从 Token 中移除，服务端通过 DB 判断
5. ✅ **I5** — FS 操作 proof 策略 → 基于 Node 鉴权，rewrite/mount 需 proof
6. ✅ **I6** — ScopeSetNode refCount → SetNode 不持有 refCount，增加 children 的 refCount
7. ✅ **I7** — Depot commit proof → 支持 proof 作为 ownership fallback
8. ✅ **D1** — Client Auth Flow → 保持不变

**所有 P2 级问题已解决**：

9. ✅ **I8** — `managedDepots` 重命名 → `delegatedDepots`，明确委派语义
10. ✅ **I9** — Token 二进制格式 → 补充 Flags 示例、编解码代码
11. ✅ **D2** — 错误码 → 新增 §10 系统化定义
12. ✅ **D3** — 迁移方案 → 不适用，本文档只讨论目标架构

仅剩余 D5（Quota 机制）作为保留项，待后续启用时再定义。架构设计已可作为实现基线。**
