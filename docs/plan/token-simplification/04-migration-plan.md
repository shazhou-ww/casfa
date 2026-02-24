# 04 — 迁移计划与实现步骤

## 概述

本文档描述从当前 TokenRecord 模型迁移到 Delegate 直接验证模型的实现步骤。
变更涉及多个 package 和服务端代码。

## 影响范围

| 层 | 包/目录 | 变更程度 | 说明 |
|----|---------|---------|------|
| Token 格式 | `@casfa/delegate-token` | **重写** | 新的 32/24 字节格式（无 magic、无 type） |
| Delegate 类型 | `@casfa/delegate` | 小改 | 新增 3 个字段 |
| Protocol Schema | `@casfa/protocol` | 中改 | 更新 response schema（去掉 tokenId） |
| Server 中间件 | `apps/server/backend/src/middleware` | **重写** | 新的 AT 验证逻辑 |
| Server Controller | `apps/server/backend/src/controllers` | **重写** | refresh、root-token、delegates |
| Server DB | `apps/server/backend/src/db` | 中改 | Delegate DB 新增 rotateTokens 方法；TokenRecord DB 标记废弃/移除 |
| Client SDK | `@casfa/client` | 小改 | 适配新 token 格式 |
| CLI | `apps/cli` | 小改 | 适配新 token 格式 |

## 实现步骤

### Phase 1：核心库变更

#### 1.1 `@casfa/delegate-token` — 新 Token 格式

**文件变更**：

| 文件 | 操作 |
|------|------|
| `src/constants.ts` | 重写：新的 size、offset 常量（无 magic、无 type） |
| `src/types.ts` | 重写：新的类型定义 |
| `src/encode.ts` | 重写：`encodeAccessToken()`, `encodeRefreshToken()` |
| `src/decode.ts` | 重写：`decodeToken()`（按字节长度区分 AT/RT） |
| `src/token-id.ts` | 保留：tokenId 计算逻辑不变 |
| `src/validate.ts` | 简化：只验证字节长度（32 = AT, 24 = RT） |
| `src/index.ts` | 更新 exports |
| `src/index.test.ts` | 重写测试 |

**关键实现**：

```typescript
// constants.ts — 无 magic、无 type，按字节长度区分 AT/RT
export const AT_SIZE = 32;
export const RT_SIZE = 24;
export const DELEGATE_ID_SIZE = 16;
export const NONCE_SIZE = 8;
export const EXPIRES_AT_SIZE = 8;

export const OFFSETS = {
  DELEGATE_ID: 0,    // 16 bytes — both AT and RT
  // AT layout: [delegateId(16)] [expiresAt(8)] [nonce(8)] = 32
  AT_EXPIRES_AT: 16, // 8 bytes
  AT_NONCE: 24,      // 8 bytes
  // RT layout: [delegateId(16)] [nonce(8)] = 24
  RT_NONCE: 16,      // 8 bytes
} as const;
```

#### 1.2 `@casfa/delegate` — 类型变更

**文件变更**：

| 文件 | 操作 |
|------|------|
| `src/types.ts` | 新增 `currentRtHash`, `currentAtHash`, `atExpiresAt` 字段 |

新增字段标记为 optional 以兼容旧数据（迁移期间）。

#### 1.3 `@casfa/protocol` — Schema 变更

**文件变更**：

| 文件 | 操作 |
|------|------|
| `src/token.ts` | 更新 response schema：去掉 `refreshTokenId`、`accessTokenId` |
| `src/delegate.ts` | 更新 `CreateDelegateResponseSchema`：同上 |

Token ID 不再是核心概念。API 响应中可以保留为可选字段（方便调试），
但不再是必需的。

### Phase 2：服务端变更

#### 2.1 Delegate DB 层

**新增方法**：

```typescript
interface DelegatesDb {
  // 现有方法签名变更（主键从 (realm, delegateId) 变为 delegateId）：

  /**
   * 通过 delegateId 查询 Delegate。
   * 主键查询，无需 realm。
   */
  get(delegateId: string): Promise<Delegate | null>;

  /**
   * 原子旋转 token hashes。
   * 使用条件表达式确保 currentRtHash 匹配且 isRevoked = false。
   * 返回 true 如果更新成功，false 如果条件不满足。
   */
  rotateTokens(params: {
    delegateId: string;
    expectedRtHash: string;
    newRtHash: string;
    newAtHash: string;
    newAtExpiresAt: number;
  }): Promise<boolean>;

  /**
   * 更新 token hashes（无条件更新，用于 root token 签发 / delegate 创建）。
   */
  updateTokenHashes(params: {
    delegateId: string;
    newRtHash: string;
    newAtHash: string;
    newAtExpiresAt: number;
  }): Promise<void>;

  // 列出某 realm 下的 delegate（走 GSI1）
  listByRealm(realm: string, options?: PaginationOptions): Promise<DelegateListResult>;

  // 列出子 delegate（走 GSI2）
  listChildren(parentId: string, options?: PaginationOptions): Promise<DelegateListResult>;
}
```

#### 2.2 中间件

**`access-token-auth.ts`** — 完全重写：

```
当前：解码 128B → 计算 tokenId → 查 TokenRecord → 查 Delegate → 构建 AuthContext
新：  解码 32B → 检查长度 → 解析 delegateId + expiresAt → 本地检查过期
      → 计算 hash → 查 Delegate（by delegateId, 主键查询）→ 比对 hash → 构建 AuthContext
```

不再依赖 `TokenRecordsDb`。

#### 2.3 Controllers

**`refresh.ts`** — 简化：

```
当前：解码 128B → 计算 tokenId → 查 TokenRecord → 检查 isUsed
      → 标记 used → 查 Delegate → 生成新 token pair → 写 2 条 TokenRecord
新：  解码 24B → 检查长度 → 解析 delegateId → 计算 oldRtHash
      → 生成新 token pair → 条件更新 Delegate（1 次操作）
```

**`root-token.ts`** — 简化：

```
当前：JWT 验证 → 查/创建 root delegate → 生成 token pair → 写 2 条 TokenRecord
新：  JWT 验证 → 查/创建 root delegate → 生成 token pair → 更新 delegate token hashes
```

**`delegates.ts`** — 简化创建部分：

```
当前：验证 → 创建 Delegate → 生成 token pair → 写 2 条 TokenRecord
新：  验证 → 生成 token pair → 创建 Delegate（含 token hashes）
```

#### 2.4 TokenRecord DB — 标记废弃

`TokenRecordsDb` 中与 token 相关的方法标记为 `@deprecated`。
由于该表还承载 `ScopeSetNode`、`OwnershipV2` 等实体，表本身不删除。

TODO：后续将非 token 实体迁移到更合适的位置。

### Phase 3：客户端适配

#### 3.1 `@casfa/client`

- 更新 token 存储逻辑
- 适配新的 API response 格式（无 tokenId）
- 确保 refresh 后立即使用新 token

#### 3.2 `apps/cli`

- 适配新的 token base64 长度
- 更新 token 文件存储格式

### Phase 4：Delegate 表主键变更

**已决定采用方案 C**：Delegate 表主键从 `(realm, delegateId)` 变更为 `(delegateId)`。

迁移步骤：
1. 创建新表（PK = `DLG#{delegateId}`, SK = `METADATA`）
2. 双写期：旧表和新表同时写入
3. 切换读取到新表
4. 停止写入旧表
5. 清理旧表

新表 GSI 设计：
- GSI1: PK = `REALM#{realm}`, SK = `DLG#{delegateId}`（列出 realm 下的 delegate）
- GSI2: PK = `PARENT#{parentId}` 或 `PARENT#ROOT`, SK = `DLG#{delegateId}`（列出子 delegate）

## 测试计划

| 测试 | 说明 |
|------|------|
| 单元测试：Token 编码/解码 | 新格式的 encode/decode round-trip |
| 单元测试：Token hash 计算 | Blake3-128 一致性 |
| 集成测试：AT 验证 | 正常验证、过期拒绝、hash 不匹配拒绝、revoke 拒绝 |
| 集成测试：RT Refresh | 正常 rotation、条件写入失败、并发 refresh |
| 集成测试：Root Token | 首次创建、重复创建（token hash 更新） |
| 集成测试：子 Delegate 创建 | 权限验证、token pair 签发 |
| E2E 测试：完整流程 | 登录 → root token → 创建子 delegate → 数据操作 → refresh → 继续操作 |

## 回滚方案

1. 旧格式 = 128 字节，新 AT = 32 字节，新 RT = 24 字节——**长度完全不同**
2. 中间件可以根据字节长度路由到不同的验证逻辑（过渡期内支持双格式）
3. 如果需要回滚，切换回旧验证路径即可
4. Delegate 实体上的新字段（`currentRtHash` 等）不影响旧逻辑

## 实现顺序建议

```
1. @casfa/delegate-token（新格式）     ← 纯库，无副作用
2. @casfa/delegate（类型变更）         ← 纯类型
3. @casfa/protocol（schema 变更）      ← 纯 schema
4. server DB 层（新增方法）            ← 添加不删除
5. server 中间件（新验证逻辑）          ← 核心变更
6. server controllers（简化）          ← 依赖 5
7. client + cli（适配）               ← 依赖 1-3
8. 清理旧代码                         ← 最后
```
