# 02 — Delegate 实体变更

## 概述

Token 验证信息从 TokenRecord 表迁移到 Delegate 实体上。
每个 Delegate 存储当前有效 RT 和 AT 的哈希，实现 1 次 DB 读即可完成验证。

## 新增字段

```typescript
interface Delegate {
  // === 现有字段（不变）===
  delegateId: string;
  name?: string;
  realm: string;
  parentId: string | null;
  chain: string[];
  depth: number;
  canUpload: boolean;
  canManageDepot: boolean;
  delegatedDepots?: string[];
  scopeNodeHash?: string;
  scopeSetNodeId?: string;
  expiresAt?: number;
  isRevoked: boolean;
  revokedAt?: number;
  revokedBy?: string;
  createdAt: number;

  // === 新增字段 ===

  /**
   * 当前有效 Refresh Token 的 Blake3-128 哈希（hex 编码，32 字符）。
   * RT refresh 时原子更新。
   * null 表示该 Delegate 尚未签发过 token（不应出现在正常流程中）。
   */
  currentRtHash: string;

  /**
   * 当前有效 Access Token 的 Blake3-128 哈希（hex 编码，32 字符）。
   * 每次 refresh 时随 RT 一起更新。
   * null 表示 AT 尚未签发。
   */
  currentAtHash: string;

  /**
   * 当前 Access Token 的过期时间（epoch ms）。
   * 冗余存储，避免在验证时需要解析 token bytes。
   * 与 currentAtHash 一起更新。
   */
  atExpiresAt: number;
}
```

## DynamoDB 属性映射

| 字段 | DynamoDB 属性名 | 类型 | 说明 |
|------|----------------|------|------|
| `currentRtHash` | `currentRtHash` | S | Blake3-128 hex, 32 chars |
| `currentAtHash` | `currentAtHash` | S | Blake3-128 hex, 32 chars |
| `atExpiresAt` | `atExpiresAt` | N | epoch ms |

这三个字段在 Delegate 创建时就被设置（创建 Delegate 必然伴随签发 RT+AT），
后续仅在 refresh 时更新。

## Delegate 创建流程变更

**当前流程**：
1. 创建 Delegate 实体 → `delegatesDb.create(delegate)`
2. 生成 RT + AT
3. 写入 RT 的 TokenRecord → `tokenRecordsDb.create(rtRecord)`
4. 写入 AT 的 TokenRecord → `tokenRecordsDb.create(atRecord)`

**新流程**：
1. 生成 RT + AT
2. 计算 `rtHash = Blake3-128(rtBytes)` 和 `atHash = Blake3-128(atBytes)`
3. 创建 Delegate 实体（含 `currentRtHash`、`currentAtHash`、`atExpiresAt`）
   → `delegatesDb.create(delegate)` —— **单次写入**

**DB 写入从 3 次降到 1 次。**

## Delegate 表主键变更（推荐）

当前主键：
- PK = `realm` (string)
- SK = `DLG#{delegateId}` (string)

为了让 token 不需要携带 realm（减小 token 体积），
且 `delegateId` 全局唯一（UUID v7），推荐变更为：

- PK = `DLG#{delegateId}` (string)
- SK = `METADATA` (string)
- GSI1: PK = `REALM#{realm}`, SK = `DLG#{delegateId}`（用于列出 realm 下的 delegate）
- GSI2: PK = `PARENT#{parentId}` 或 `PARENT#ROOT`, SK = `DLG#{delegateId}`（用于列出子 delegate）

**决定采用此方案。** `delegateId` 全局唯一，作为主键最自然；
token 中不需要携带 realm，格式最简。

## 语义变更

### 一个 Delegate 同一时间只有 1 个有效 RT 和 1 个有效 AT

这是核心语义变更。当前模型中，一个 Delegate 可能有多个 TokenRecord（比如
历史 RT、多个 AT）。新模型下：

- `currentRtHash` 只有一个值 → 只有一个有效 RT
- `currentAtHash` 只有一个值 → 只有一个有效 AT
- refresh 时两者同时原子更新 → 旧 RT 和旧 AT **立即失效**

这与"一个 Delegate = 一个客户端"的设计原则一致。

### Revoke 简化

当前 revoke 一个 Delegate 后，还需要扫描并 invalidate 该 Delegate 关联的所有
TokenRecord（通过 GSI1 `TOKDLG#{delegateId}` 查询）。

新模型下，revoke Delegate 后：
- `isRevoked = true` 即可
- 任何 token 验证都会检查 `delegate.isRevoked`，自然被拒绝
- **不需要扫描 token 记录，O(1) 操作**

### RT Replay 检测

当前检测到 RT replay 时，需要 invalidate 整个 token family
（扫描所有关联 TokenRecord 并逐条更新 `isInvalidated`）。

新模型下：
- RT hash 不匹配 → 条件更新失败 → 直接拒绝请求，返回错误
- **不自动 revoke Delegate**——避免因客户端 bug（如重发旧 RT）导致误伤
- 如果是真正的 token 被盗场景，合法客户端仍持有最新 RT，不受影响

## 条件更新保证原子性

RT refresh 时使用 DynamoDB 条件表达式确保原子性：

```
UpdateItem:
  Key: { pk: "DLG#{delegateId}", sk: "METADATA" }
  UpdateExpression:
    SET currentRtHash = :newRtHash,
        currentAtHash = :newAtHash,
        atExpiresAt = :newAtExpiresAt
  ConditionExpression:
    currentRtHash = :oldRtHash
    AND isRevoked = :false
```

如果条件不满足（`currentRtHash` 已变 → 说明有另一个请求先 refresh 了，
或 Delegate 已被 revoke），操作失败，返回错误。

这比当前的"标记 isUsed + 条件更新 + 全家族 invalidation"简洁得多。
