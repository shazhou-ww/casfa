# Token 简化：消除 TokenRecord，基于 Delegate 实体直接验证

## 背景

在当前的 Delegate-as-Entity 架构中，所有权限管理（`canUpload`、`canManageDepot`、scope、
delegation chain 等）已经完全放在了 Delegate 实体上。Token 只是一个"访问凭证"，
用于证明持有者可以代表某个 Delegate 行事。

然而，当前实现仍然为每个 Token（RT 和 AT）在 DynamoDB 中维护一条 `TokenRecord`：

| 操作 | DB 读取 | DB 写入 | 说明 |
|------|---------|---------|------|
| AT 验证 | 2 | 0 | 查 TokenRecord + 查 Delegate |
| RT Refresh | 2 | 3 | 查 TokenRecord + 查 Delegate → 标记旧 RT used + 写新 RT record + 写新 AT record |
| 创建子 Delegate | 5-6 | 3-5 | 含 auth 中间件 2 读 + 写 Delegate + 写 2 条 TokenRecord |
| RT Replay 检测 | 1+query | O(N) | 扫描并 invalidate 整个 token family |

`TokenRecord` 本质上只是一个"tokenId → delegateId 映射 + 状态标记"，这个中间层
在 Delegate-as-Entity 模型下是冗余的。

## 核心思路

**将 Token 的验证信息直接存储在 Delegate 实体上，彻底消除 TokenRecord。**

- 每个 Delegate 创建时随机生成 nonce，写入 token 中
- Delegate 存储当前有效 RT 和 AT 的哈希（Blake3-128）
- Token 验证 = 查 Delegate（1 次 DB 读）+ 本地比对哈希
- RT Refresh = 查 Delegate（1 读）+ 条件更新 Delegate（1 写）

## 设计原则

1. **一个 Delegate = 一个客户端会话**：不存在两个客户端共享同一个 RT 的合法场景
2. **RT 无 TTL**：Refresh Token 长期有效，直到 Delegate 被 revoke
3. **AT 短生命周期**：Access Token 默认 1 小时，不需要单独撤销机制
4. **客户端行为**：AT 过期后才 refresh（每次使用前检查 AT 是否有效，无效则先 refresh）
5. **Token 格式精简**：不补全到 128 字节，只包含必要信息

## 目录

- [01-new-token-format.md](./01-new-token-format.md) — 新的 Token 二进制格式
- [02-delegate-changes.md](./02-delegate-changes.md) — Delegate 实体变更
- [03-verification-flow.md](./03-verification-flow.md) — 验证与刷新流程
- [04-migration-plan.md](./04-migration-plan.md) — 迁移计划与实现步骤
