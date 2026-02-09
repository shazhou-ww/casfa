# CASFA 权限体系实施计划

> 基于: ownership-and-permissions.md v3.5
> 日期: 2026-02-09

---

## 原则

1. **每步可独立验证**——每步结束时有明确的测试/验证标准，CI 绿灯即可合并
2. **新建独立 package 承载独立逻辑**——纯函数/纯类型的逻辑从 server 中拆出
3. **向后兼容优先**——旧 API 在迁移期间保留，新旧并行直到切换完成
4. **由底向上**——先做纯数据层（类型、编码、DB），再做业务层（API、中间件），最后做集成层（客户端）

---

## 现状快照

| 层级 | 已有 | 缺失 / 需改造 |
|------|------|---------------|
| **Token 二进制格式** | `@casfa/delegate-token` — 128B encode/decode | Flags 需更新（加 `is_refresh`，去掉 `isDelegate`/`isUserIssued`）；Issuer 语义从 "parent token hash" 改为 "Delegate UUID" |
| **Delegate 实体** | 无（当前 DelegateToken 记录混合了实体和凭证） | 需新建 Delegate 记录（PK=REALM#, SK=DLG#）、chain、delegatedDepots |
| **Ownership** | `db/ownership.ts` — OWN#{key}##{ownerId}（单条写入） | 需改为 delegate-ID-based + 全链写入（BatchWriteItem） |
| **Scope / Proof** | `X-CAS-Index-Path`（单路径） | 需替换为 `X-CAS-Proof`（多节点 proof + depot-version proof） |
| **Claim API** | 无 | 新端点 + Keyed Blake3 PoP |
| **Refresh Token** | JWT-based（Cognito/local） | 需新增 binary RT + rotation |
| **Redis 缓存** | 无 | chain 验证缓存 |
| **Protocol 契约** | `@casfa/protocol` — Zod schemas | 缺 Delegate CRUD、Claim、X-CAS-Proof、delegatedDepots 等 |
| **Client** | `@casfa/client` — JWT→DelegateToken→AT | 需改造为 JWT→Root Delegate→child Delegate (RT+AT) |

---

## Step 0 — Token 二进制格式升级

> **产出**: 更新 `@casfa/delegate-token` package
> **范围**: 纯库，无 server 变更

### 0.1 变更清单

| 项目 | Before | After |
|------|--------|-------|
| Flags bit 0 | `isDelegate` | `is_refresh` |
| Flags bit 1 | `isUserIssued` | `can_upload` |
| Flags bit 2 | `can_upload` | `can_manage_depot` |
| Flags bit 3 | `can_manage_depot` | reserved |
| Flags bits 4-7 | `depth` | `depth` (0–15)，高半字节对齐 |
| Issuer 语义 | parent token hash 或 user hash | Delegate UUID（16B left-padded to 32B） |
| Token ID 前缀 | `dlt1_` | `dlt1_`（不变） |

### 0.2 具体任务

1. 更新 `constants.ts` — FLAGS 位定义
2. 更新 `types.ts` — `TokenFields` 类型（加 `isRefresh`，去 `isDelegate`/`isUserIssued`）
3. 更新 `encode.ts` / `decode.ts` — 对齐新 Flags 布局
4. 更新 `validate.ts` — 对齐新校验规则
5. 更新所有单元测试（`index.test.ts`）

### 0.3 验证标准

- [x] `bun test packages/delegate-token` 全部通过 — 48 tests, 87 assertions ✅ `3b8bbcc`
- [x] encode → decode round-trip 覆盖: RT、AT、root delegate、depth=15、只读等场景 ✅
- [x] Flags 位组合与设计文档 §3.4 表格完全一致 ✅

---

## Step 1 — Delegate 实体与 DB 层

> **产出**: 新 package `@casfa/delegate` + server `db/delegates.ts`
> **范围**: 纯数据模型 + DB CRUD，无 API 路由

### 1.1 新 package: `@casfa/delegate`

纯类型 + 纯函数库，不依赖 DynamoDB：

```
packages/delegate/
  src/
    types.ts          — Delegate, DelegateChain, DelegatePermissions 类型
    chain.ts          — buildChain(), isAncestor(), chainDepth()
    validation.ts     — validatePermissionSubset(), validateScopeSubset(),
                        validateDelegatedDepots(), validateDepth()
    constants.ts      — MAX_DEPTH=16, DELEGATE_ID_PREFIX="dlg_"
    index.ts
```

**类型定义** (types.ts):

```typescript
interface Delegate {
  delegateId: string;           // UUID v7
  name?: string;
  realm: string;
  parentId: string | null;      // null for root
  chain: string[];              // [root, ..., self]
  depth: number;                // 0–15
  canUpload: boolean;
  canManageDepot: boolean;
  delegatedDepots?: string[];   // immutable, parent-assigned
  scopeNodeHash?: string;       // single scope
  scopeSetNodeId?: string;      // multi scope
  expiresAt?: number;           // epoch ms
  isRevoked: boolean;
  revokedAt?: number;
  revokedBy?: string;
  createdAt: number;
}
```

**纯函数** (chain.ts, validation.ts):

- `buildChain(parentChain, childId)` → `[...parentChain, childId]`
- `isAncestor(ancestorId, chain)` → boolean
- `validatePermissions(parent, child)` → Result（canUpload ≤ parent, depth ≤ 15 等）
- `validateDelegatedDepots(parentManageable, requested)` → Result

### 1.2 Server: `db/delegates.ts`

DynamoDB 操作层：

```typescript
// Delegate 记录 CRUD
createDelegate(delegate: Delegate): Promise<void>
getDelegate(realm: string, delegateId: string): Promise<Delegate | null>
revokeDelegate(realm: string, delegateId: string, revokedBy: string): Promise<void>
listDescendants(realm: string, parentId: string): Promise<Delegate[]>

// Root Delegate
getOrCreateRootDelegate(realm: string, userId: string): Promise<Delegate>
```

**DynamoDB schema**:

```
PK = REALM#{realm}       SK = DLG#{delegateId}
GSI: PK = PARENT#{parentId}  SK = DLG#{delegateId}
```

### 1.3 验证标准

- [x] `bun test packages/delegate` 全部通过（chain 构建、权限验证、边界 case）— 53 tests, 71 assertions ✅ `f39f290`
- [x] Server 单元测试: delegate CRUD on local DynamoDB — 11 tests ✅ `f8310db`
- [x] `validatePermissions` 拒绝: 子权限 > 父权限、depth > 15、delegatedDepots 逃逸 ✅

---

## Step 2 — Ownership 全链写入

> **产出**: 改造 server `db/ownership.ts` + 新增 `@casfa/delegate` 中 ownership 辅助函数
> **范围**: DB 层改造，不动 API 路由

### 2.1 变更清单

| Before | After |
|--------|-------|
| `OWN#{key}##{ownerId}` — ownerId 是 token ID 或 user ID | `PK=OWN#{nodeHash} SK={delegateId}` — 主体是 Delegate |
| 每次 PUT 写 1 条 | 每次 PUT 写 N 条（N = chain.length），BatchWriteItem |
| 查询: `Query(PK=OWN#key##, SK begins_with owner)` | 查询: `GetItem(PK=OWN#{hash}, SK={delegateId})` — **O(1)** |

### 2.2 具体任务

1. 新 `addOwnership(nodeHash, chain, metadata)` — BatchWriteItem 为 chain 每个 delegate 写一条
2. 新 `hasOwnership(nodeHash, delegateId)` — GetItem O(1)
3. 新 `hasAnyOwnership(nodeHash)` — Query + Limit 1
4. 迁移旧 ownership 查询点（prepare-nodes, PUT children 验证, scope 验证）
5. 旧函数标记 `@deprecated`，保留到 Step 6 切换完成后删除

### 2.3 验证标准

- [x] 单元测试: 全链写入 → 祖先 GetItem 命中、旁支 GetItem 未命中 — 18 tests, 53 assertions ✅ `b4209c0`
- [x] 单元测试: 幂等覆盖（同 delegate 重复上传同一 Node）✅
- [x] 单元测试: chain 深度 1（root 直接上传）到深度 16 边界 ✅

---

## Step 3 — X-CAS-Proof 与 Scope 验证

> **产出**: 新 package `@casfa/proof` + 改造 server middleware
> **范围**: proof 解析 + 验证逻辑

### 3.1 新 package: `@casfa/proof`

纯函数库，不依赖 DB（接收一个 `resolveNode` 回调）：

```
packages/proof/
  src/
    types.ts          — ProofWord, ProofMap, ProofResult
    parse.ts          — parseProofHeader(headerValue) → Record<nodeHash, ProofWord>
    verify.ts         — verifyProof(proofWord, scopeRoots, resolveNode) → Result
    format.ts         — formatProofHeader(proofMap) → string  (客户端用)
    index.ts
```

**ProofWord 格式**:

```typescript
type ProofWord =
  | { type: "ipath"; scopeIndex: number; path: number[] }         // "ipath#0:1:2"
  | { type: "depot"; depotId: string; version: string; path: number[] }  // "depot:ID@VER#0:1:2"
```

**验证函数**:

```typescript
async function verifyNodeAccess(
  nodeHash: string,
  delegateId: string,
  proofMap: Record<string, string>,
  ctx: {
    hasOwnership: (hash: string, delegateId: string) => Promise<boolean>;
    isRootDelegate: (delegateId: string) => Promise<boolean>;
    getScopeRoots: (delegateId: string) => Promise<string[]>;
    resolveNode: (hash: string) => Promise<{ children: string[] } | null>;
    resolveDepotVersion: (depotId: string, version: string) => Promise<string | null>;
    hasDepotAccess: (delegateId: string, depotId: string) => Promise<boolean>;
  }
): Promise<Result<void, AuthError>>
```

### 3.2 Server: middleware 改造

1. 新建 `middleware/proof-validation.ts` — 替代 `scope-validation.ts`
2. 读取 `X-CAS-Proof` header（替代 `X-CAS-Index-Path`）
3. 对请求涉及的每个 nodeHash 调用 `verifyNodeAccess`
4. 旧 `X-CAS-Index-Path` 中间件保留，标记 `@deprecated`

### 3.3 验证标准

- [x] `bun test packages/proof` 全部通过 — 69 tests, 94 assertions ✅ `e6cc8bc`
- [x] 单元测试: ipath 正确导航到目标节点 ✅
- [x] 单元测试: depot-version proof 正确解析和验证 ✅
- [x] 单元测试: ownership 优先 → 跳过 proof ✅
- [x] 单元测试: root delegate → 跳过 proof ✅
- [x] 单元测试: proof 路径不匹配 → 403 ✅
- [x] Server middleware 集成测试: 新旧 header 可并行（过渡期）— 16 tests, 23 assertions ✅

---

## Step 4 — Delegate API 与 Token 刷新

> **产出**: server 新路由 + protocol schema 更新
> **范围**: API 层

### 4.1 Protocol schema 新增

在 `@casfa/protocol` 中新增:

```
src/
  delegate.ts         — CreateDelegateRequest/Response, ListDelegatesResponse,
                        GetDelegateResponse, RevokeDelegateRequest
  claim.ts            — ClaimNodeRequest/Response
  proof.ts            — ProofHeader schema
```

更新:

```
src/
  token.ts            — RefreshTokenRequest/Response (binary RT)
  auth.ts             — POST /api/tokens/root schema
```

### 4.2 Server 新路由

| 端点 | 说明 |
|------|------|
| `POST /api/tokens/root` | JWT → Root Delegate + RT + AT |
| `POST /api/tokens/refresh` | Binary RT → 新 RT + 新 AT（rotation） |
| `POST /api/realm/{realmId}/delegates` | AT → 创建子 Delegate + RT + AT |
| `GET /api/realm/{realmId}/delegates` | AT → 列出子孙 Delegate |
| `GET /api/realm/{realmId}/delegates/{id}` | AT → Delegate 详情 |
| `POST /api/realm/{realmId}/delegates/{id}/revoke` | AT → Revoke 子孙 |

### 4.3 Token 刷新 — RT Rotation

```typescript
// db/tokens.ts
interface TokenRecord {
  tokenId: string;          // dlt1_xxx
  tokenType: "refresh" | "access";
  delegateId: string;
  realm: string;
  expiresAt?: number;
  isUsed: boolean;          // for RT one-time-use
  isInvalidated: boolean;   // for token family invalidation
  createdAt: number;
}

// Refresh flow:
// 1. Decode binary RT → compute tokenId
// 2. GetItem TOKEN#{tokenId} → check isUsed
//    - isUsed=true → TOKEN_USED (409), invalidate token family
//    - isUsed=false → mark isUsed=true, issue new RT + AT
```

### 4.4 Chain 验证中间件

新建 `middleware/chain-validation.ts`:

```typescript
// validateChain(chain: string[]):
//   for each delegateId in chain:
//     check Redis cache "dlg:revoked:{id}" → "1" means revoked
//     cache miss → DynamoDB GetItem → write cache
//     any revoked/expired → 401 CHAIN_INVALID
```

- Redis 可选依赖——不可用时 fallback 到 DynamoDB BatchGetItem
- 缓存 TTL = AT 有效期（如 1h）

### 4.5 验证标准

> Commit `206a922` — 82 tests, 160+ assertions (root-token 24, refresh 29, delegates 20, delegate-token-utils 9)

- [x] E2E: JWT → `/api/tokens/root` → 返回 root delegate + RT + AT
- [x] E2E: RT → `/api/tokens/refresh` → 返回新 RT + AT；旧 RT 再用 → 409
- [x] E2E: AT → `POST /delegates` → 创建子 delegate；权限 > 父 → 400
- [x] E2E: AT → `GET /delegates` → 列出子孙（不含旁支）
- [x] E2E: AT → `POST /delegates/{id}/revoke` → revoke 后子孙 chain 失效
- [x] E2E: delegatedDepots 超范围 → 400 PERMISSION_ESCALATION
- [x] 单元测试: RT rotation conflict → invalidate token family
- [ ] 集成测试: Redis 缓存命中/未命中路径、Redis 不可用 fallback *(deferred to Step 6)*

---

## Step 5 — Claim API

> **产出**: server 新路由 + `@casfa/proof` 中 PoP 函数
> **范围**: 新端点

### 5.1 PoP 计算函数

在 `@casfa/proof` 或 `@casfa/delegate-token` 中添加:

```typescript
function computePoP(tokenBytes: Uint8Array, content: Uint8Array): string {
  const popKey = blake3_256(tokenBytes);           // 128B → 32B key
  const popHash = blake3_128(content, { key: popKey }); // keyed hash
  return "pop:" + crockfordBase32Encode(popHash);
}

function verifyPoP(
  pop: string,
  tokenBytes: Uint8Array,
  content: Uint8Array
): boolean {
  return pop === computePoP(tokenBytes, content);
}
```

### 5.2 Server 路由

```
POST /api/realm/{realmId}/nodes/{key}/claim
Authorization: Bearer {access_token_base64}
Body: { "pop": "pop:XXXXX..." }
```

验证流程（§6.4）:

1. validateToken + canUpload
2. 节点存在？（404）
3. 已有 ownership？（200 幂等）
4. 从 CAS 读内容 → 计算 PoP → 比对（403 INVALID_POP）
5. 全链写入 ownership → 200

### 5.3 验证标准

- [ ] 单元测试: computePoP / verifyPoP round-trip
- [ ] 单元测试: 不同 token 对同一 content → 不同 PoP（防重放）
- [ ] E2E: claim 成功后 prepare-nodes 返回 `owned`
- [ ] E2E: 错误 PoP → 403 INVALID_POP
- [ ] E2E: 节点不存在 → 404 NODE_NOT_FOUND
- [ ] E2E: 已有 ownership → 200 幂等

---

## Step 6 — Server 全链集成与旧路由迁移

> **产出**: server 所有路由切换到新模型
> **范围**: 集成 + 迁移

### 6.1 路由迁移清单

| 旧路由 | 新路由 | 说明 |
|--------|--------|------|
| `POST /api/tokens` (JWT → DelegateToken) | `POST /api/tokens/root` (JWT → Root Delegate RT+AT) | §3.7 |
| `POST /api/tokens/:id/delegate` (DT → child) | `POST /api/realm/{realmId}/delegates` (AT → child Delegate) | §2.7 |
| `POST /api/tokens/:id/revoke` | `POST /api/realm/{realmId}/delegates/{id}/revoke` | §2.7 |
| `GET /api/tokens` | `GET /api/realm/{realmId}/delegates` | §2.7 |
| `X-CAS-Index-Path` | `X-CAS-Proof` | §5.2 |
| 单条 ownership 写入 | 全链写入 | §4.2 |

### 6.2 中间件栈切换

```
现有:
  jwt-auth / delegate-token-auth / access-token-auth → realm-access → scope-validation → handler

新:
  validateToken (统一 AT 解码 + chain 验证) → authorizeRequest (权限 + proof) → zValidator → handler
```

### 6.3 旧路由处理

- 所有旧路由添加 `Deprecation` header + 文档说明
- 设置下线日期（建议 2 个版本后）
- Ticket 相关路由（`/tickets/*`）可保留或按需废弃（新模型中 delegate + scope 替代 ticket）

### 6.4 验证标准

- [ ] 所有现有 E2E 测试继续通过（`apps/cli/e2e/`）
- [ ] 新 E2E 测试: 端到端流程（§8.1 Agent 上传文件树）
- [ ] 新 E2E 测试: 跨分支引用（§8.3）
- [ ] 新 E2E 测试: Revoke 与权限回收（§8.5）
- [ ] 新 E2E 测试: Claim 流程（§8.6）
- [ ] 新 E2E 测试: 工具调用流程（§8.7）
- [ ] TypeScript 编译无错误

---

## Step 7 — Client SDK 改造

> **产出**: 更新 `@casfa/client`
> **范围**: 客户端库

### 7.1 变更清单

| Before | After |
|--------|-------|
| `CasfaClient` 三层 token: JWT → DT → AT | `CasfaClient` 两层: JWT → Root Delegate（RT+AT）→ child Delegate（RT+AT） |
| Token store: `DelegateTokenStore` | Token store: `DelegateStore`（管理 RT rotation） |
| 无 PoP | `computePoP()` for Claim API |
| 无 proof 构造 | `buildProof()` for X-CAS-Proof header |
| Delegate 管理: 无 | `createDelegate()`, `listDelegates()`, `revokeDelegate()` |

### 7.2 新增方法

```typescript
class CasfaClient {
  // Delegate 管理
  async createDelegate(opts: CreateDelegateOpts): Promise<DelegateWithTokens>
  async listDelegates(): Promise<Delegate[]>
  async getDelegate(id: string): Promise<Delegate>
  async revokeDelegate(id: string): Promise<void>

  // Token 管理（内部自动 rotation）
  async getAccessToken(): Promise<string>  // 自动刷新 RT → 新 RT + AT

  // Claim
  async claimNode(key: string, content: Uint8Array): Promise<void>

  // Proof 构造
  buildProof(nodeHash: string, path: number[]): string
}
```

### 7.3 验证标准

- [ ] 单元测试: RT rotation — AT 过期 → 自动刷新 → 新 RT + AT
- [ ] 单元测试: RT rotation conflict — 409 → 抛出可恢复异常
- [ ] 单元测试: createDelegate 权限验证
- [ ] 集成测试: client E2E flow（create delegate → upload → claim → commit）

---

## Step 8 — CLI 适配

> **产出**: 更新 `apps/cli`
> **范围**: CLI 命令

### 8.1 变更清单

1. `auth` 命令: JWT 登录后获取 root delegate RT+AT（替代旧 delegate token）
2. `config` 命令: 存储 RT（本地加密），AT 按需刷新
3. `push`/`pull` 命令: 使用新 Proof header
4. 新增 `delegate` 子命令: create / list / revoke
5. `node claim` 子命令: 支持 Claim API

### 8.2 验证标准

- [ ] `apps/cli/e2e/auth.test.ts` 通过
- [ ] `apps/cli/e2e/node.test.ts` 通过
- [ ] 新增 `apps/cli/e2e/delegate.test.ts` — delegate 生命周期
- [ ] 手动验证: `casfa auth login` → `casfa delegate create` → `casfa push`

---

## 总览：步骤依赖图

```
Step 0: Token 二进制格式升级         ← 无依赖，可立即开始
  │
Step 1: Delegate 实体与 DB 层        ← 依赖 Step 0（Token 类型更新）
  │
  ├── Step 2: Ownership 全链写入     ← 依赖 Step 1（Delegate chain）
  │
  └── Step 3: X-CAS-Proof           ← 依赖 Step 1（Delegate scope）
        │
Step 4: Delegate API + Token 刷新    ← 依赖 Step 1 + Step 0
  │
Step 5: Claim API                    ← 依赖 Step 2（ownership） + Step 0（token bytes for PoP）
  │
Step 6: Server 全链集成              ← 依赖 Step 2 + 3 + 4 + 5（所有组件就绪）
  │
Step 7: Client SDK 改造              ← 依赖 Step 6（API 稳定）
  │
Step 8: CLI 适配                     ← 依赖 Step 7（Client SDK 就绪）
```

**可并行的步骤**:

- Step 2 与 Step 3 可并行（都只依赖 Step 1）
- Step 4 可与 Step 2/3 并行（只依赖 Step 1 + Step 0）
- Step 5 依赖 Step 2，但可与 Step 3/4 并行

```
时间线（理想）:

Week 1:  [Step 0] ──── [Step 1]
Week 2:  [Step 2] ──── [Step 3] ──── (并行)
         [Step 4] ──── (并行)
Week 3:  [Step 5]
Week 4:  [Step 6]
Week 5:  [Step 7] ──── [Step 8]
```

---

## 新增 / 改造 Package 汇总

| Package | 类型 | 说明 |
|---------|------|------|
| `@casfa/delegate-token` | **改造** | Token 128B 二进制格式，更新 Flags 和 Issuer 语义 |
| `@casfa/delegate` | **新建** | Delegate 类型、chain 操作、权限验证纯函数 |
| `@casfa/proof` | **新建** | Proof 解析/验证/格式化 + PoP 计算/验证 |
| `@casfa/protocol` | **改造** | 新增 Delegate CRUD、Claim、Proof、Token refresh schemas |
| `@casfa/client` | **改造** | 新 Delegate 管理 + RT rotation + Claim + Proof 构造 |
| `apps/server` | **改造** | DB 层 + 路由 + 中间件全面升级 |
| `apps/cli` | **改造** | 适配新 auth 模型 + delegate 子命令 |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Ownership 数据迁移（旧 token-based → 新 delegate-based） | Step 6 提供迁移脚本；旧数据只读保留，新数据并行写入 |
| Redis 引入增加运维复杂度 | Redis 为可选依赖，fallback 到 DynamoDB BatchGetItem |
| 旧客户端不兼容 | 旧 API 保留 2 个版本周期；客户端版本检测 |
| Token 格式变更导致已有 Token 失效 | 发布时所有用户需重新登录获取新 Token；这是预期行为 |
