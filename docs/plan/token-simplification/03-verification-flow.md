# 03 — 验证与刷新流程

## 概述

新模型下所有 token 操作都围绕 Delegate 实体进行，不再涉及 TokenRecord 表。

## 1. Access Token 验证

**触发时机**：每个需要认证的 API 请求。

```
客户端                          服务端
  │                               │
  │  Authorization: Bearer {AT}   │
  │──────────────────────────────>│
  │                               │
  │                     1. Base64 解码 → atBytes
  │                     2. 检查长度 == 32 字节（AT）
  │                     3. 解析 delegateId（前 16 字节）
  │                     4. 解析 expiresAt（字节 16-23）→ 检查是否过期
  │                     5. 计算 atHash = Blake3-128(atBytes)
  │                     6. 查 Delegate by delegateId（1 次 DB 读）
  │                        └→ 检查 delegate 存在
  │                        └→ 检查 isRevoked = false
  │                        └→ 检查 delegate.expiresAt 未过期
  │                        └→ 比对 delegate.currentAtHash == atHash
  │                     7. 构建 AuthContext
  │                               │
  │  200 OK / 401 Unauthorized    │
  │<──────────────────────────────│
```

**DB 操作**：1 读，0 写（对比当前的 2 读 0 写）

**伪代码**：

```typescript
async function verifyAccessToken(tokenBase64: string): Promise<AuthContext | Error> {
  // 1. 解码
  const bytes = base64Decode(tokenBase64);
  if (bytes.length !== 32) return Error("INVALID_TOKEN_FORMAT"); // 32B = AT
  const decoded = decodeToken(bytes); // type = "access" (by length)

  // 2. 检查过期（本地，无需 DB）
  if (decoded.expiresAt < Date.now()) return Error("TOKEN_EXPIRED");

  // 3. 计算哈希
  const atHash = hex(blake3_128(bytes));

  // 4. 查 Delegate（PK = delegateId，单次主键查询）
  const delegate = await delegatesDb.get(decoded.delegateId);
  if (!delegate) return Error("DELEGATE_NOT_FOUND");
  if (delegate.isRevoked) return Error("DELEGATE_REVOKED");
  if (delegate.expiresAt && delegate.expiresAt < Date.now()) return Error("DELEGATE_EXPIRED");

  // 5. 比对哈希
  if (delegate.currentAtHash !== atHash) return Error("TOKEN_INVALID");

  // 6. 成功
  return {
    type: "access",
    delegate,
    delegateId: delegate.delegateId,
    realm: delegate.realm,
    canUpload: delegate.canUpload,
    canManageDepot: delegate.canManageDepot,
    issuerChain: delegate.chain,
  };
}
```

**注意**：步骤 2 中 `expiresAt` 的本地检查是一个**提前退出优化**——即使跳过这步，
步骤 5 的哈希比对也能保证安全性（过期 token 的 hash 仍然匹配，
但 `delegate.atExpiresAt` 可以作为额外检查）。保留本地检查可以避免对已过期 token
发起不必要的 DB 查询。

## 2. Refresh Token 刷新（Token Rotation）

**触发时机**：客户端检测到 AT 过期，发起 refresh 请求。

```
客户端                          服务端
  │                               │
  │  POST /api/tokens/refresh     │
  │  Authorization: Bearer {RT}   │
  │──────────────────────────────>│
  │                               │
  │                     1. Base64 解码 → rtBytes
  │                     2. 检查长度 == 24 字节（RT）
  │                     3. 解析 delegateId（前 16 字节）
  │                     4. 计算 oldRtHash = Blake3-128(rtBytes)
  │                     5. 生成新 RT + 新 AT
  │                        └→ newRt = encodeRefreshToken(delegateId)
  │                        └→ newAt = encodeAccessToken(delegateId, expiresAt)
  │                     6. 计算 newRtHash, newAtHash
  │                     7. 条件更新 Delegate（1 次条件写入）
  │                        └→ SET currentRtHash = newRtHash,
  │                               currentAtHash = newAtHash,
  │                               atExpiresAt = newAtExpiresAt
  │                           WHERE currentRtHash = oldRtHash
  │                             AND isRevoked = false
  │                               │
  │  ┌─ 成功：返回新 RT + 新 AT   │
  │  │  ┌─ 条件失败（hash 不匹配）│
  │  │  │  → RT 已被使用或 Delegate 已 revoke
  │  │  │  → 返回 401 或 409     │
  │                               │
  │  { refreshToken, accessToken }│
  │<──────────────────────────────│
```

**DB 操作**：1 条件写入（包含隐式读取）

DynamoDB 的 `UpdateItem` with `ConditionExpression` 是原子操作：
- 条件满足 → 更新成功 → 返回新 token pair
- 条件不满足 → 返回 `ConditionalCheckFailedException`

**伪代码**：

```typescript
async function refreshToken(tokenBase64: string): Promise<TokenPair | Error> {
  // 1. 解码
  const bytes = base64Decode(tokenBase64);
  if (bytes.length !== 24) return Error("NOT_REFRESH_TOKEN"); // 24B = RT
  const decoded = decodeToken(bytes); // type = "refresh" (by length)

  // 2. 计算旧哈希
  const oldRtHash = hex(blake3_128(bytes));

  // 3. 生成新 token pair
  const delegateIdBytes = decoded.delegateId;
  const newAtExpiresAt = Date.now() + AT_TTL_MS;
  const newRtBytes = encodeRefreshToken({ delegateId: delegateIdBytes });
  const newAtBytes = encodeAccessToken({ delegateId: delegateIdBytes, expiresAt: newAtExpiresAt });
  const newRtHash = hex(blake3_128(newRtBytes));
  const newAtHash = hex(blake3_128(newAtBytes));

  // 4. 条件更新 Delegate（原子操作）
  const success = await delegatesDb.rotateTokens({
    delegateId: formatDelegateId(delegateIdBytes),
    expectedRtHash: oldRtHash,
    newRtHash,
    newAtHash,
    newAtExpiresAt,
  });

  if (!success) {
    // 条件不满足：RT 已失效、已被使用或 Delegate 已 revoke
    // 可选：检查具体原因并 revoke Delegate（replay 检测）
    return Error("REFRESH_FAILED");
  }

  // 5. 返回新 token pair
  return {
    refreshToken: base64Encode(newRtBytes),
    accessToken: base64Encode(newAtBytes),
    accessTokenExpiresAt: newAtExpiresAt,
  };
}
```

### RT Replay 检测

当 `currentRtHash != oldRtHash` 时（条件更新失败），可能的原因：
1. **正常场景**：客户端已经 refresh 过了，旧 RT 自然失效
2. **异常场景**：旧 RT 被盗用，攻击者试图重放

**处理方式：直接拒绝，不自动 revoke Delegate。**

```typescript
if (!success) {
  return Error("REFRESH_FAILED");
}
```

理由：
- 如果客户端有 bug 导致重发旧 RT，自动 revoke 会造成误伤
- 在真正的 token 被盗场景中，合法客户端仍持有最新 RT，攻击者持有的旧 RT 无法通过哈希比对
- 如果攻击者先于合法客户端 refresh，合法客户端的旧 RT 失效后需要重新登录——
  这是合理的安全行为，不需要额外 revoke

## 3. 根 Token 签发（Root Token Issuance）

**触发时机**：用户通过 JWT 登录后获取 root delegate 的 RT+AT。

```
客户端                          服务端
  │                               │
  │  POST /api/tokens/root        │
  │  Authorization: Bearer {JWT}  │
  │──────────────────────────────>│
  │                               │
  │                     1. 验证 JWT（本地，无 DB）
  │                     2. 确定 realm = userId
  │                     3. 查询/创建 root delegate
  │                        └→ 如果已存在 → 生成新 RT+AT，更新 hash
  │                        └→ 如果不存在 → 创建 root delegate（含 RT+AT hash）
  │                     4. 返回 delegate info + RT + AT
  │                               │
  │  { delegate, RT, AT }         │
  │<──────────────────────────────│
```

**DB 操作**：
- Root delegate 已存在：1 读（查询）+ 1 写（更新 token hash）= 2 操作
- Root delegate 不存在：1 读（查询）+ 1 写（创建）= 2 操作

对比当前：1 读 + 1 写（delegate）+ 2 写（token records）= 4 操作

**注意**：每次调用 `/api/tokens/root` 都会生成新的 RT+AT，使之前的 token 失效。
这是合理的——用户重新登录意味着开启新的会话。

## 4. 子 Delegate 创建

**触发时机**：父 delegate 创建子 delegate。

```
客户端                          服务端
  │                               │
  │  POST /api/realm/{r}/delegates│
  │  Authorization: Bearer {AT}   │
  │──────────────────────────────>│
  │                               │
  │                     1. AT 验证（见上方流程 1）
  │                     2. 验证权限（canManageDepot 等）
  │                     3. 解析 scope（可能需要额外 DB 读取）
  │                     4. 生成子 delegate + RT + AT
  │                     5. 创建子 Delegate 实体（含 token hash）
  │                        → 单次 PutItem
  │                     6. 返回子 delegate info + RT + AT
  │                               │
```

**DB 操作**：
- AT 验证：1 读（Delegate）
- 查父 Delegate（可能与上面重叠）：0-1 读
- scope 解析：0-2 读
- 创建子 Delegate：1 写

**总计**：2-4 读 + 1 写（对比当前 5-6 读 + 3-5 写）

## 5. 操作对比总结

| 操作 | 当前模型 | 新模型 | 改善 |
|------|---------|--------|------|
| **AT 验证** | 2 读 0 写 | **1 读 0 写** | -50% 读取 |
| **RT Refresh** | 2 读 3 写 | **0 读 1 条件写** | -100% 显式读，-67% 写 |
| **Root Token 签发** | 1 读 3 写 | **1 读 1 写** | -67% 写 |
| **创建子 Delegate** | 5-6 读 3-5 写 | **2-4 读 1 写** | ~-50% 读，~-75% 写 |
| **Revoke Delegate** | 1 写 + O(N) token invalidate | **1 写** | 从 O(N) 到 O(1) |
| **RT Replay 检测** | 1 query + O(N) 写 | **1 条件写失败** | 从 O(N) 到 O(1) |

## 6. 客户端行为规范

```
┌──────────────────────────────────┐
│         客户端 Token 管理         │
│                                  │
│  1. 持久存储：RT (base64)        │
│  2. 内存缓存：AT (base64)        │
│              + atExpiresAt       │
│                                  │
│  每次 API 调用前：               │
│    if (AT 未过期)                │
│      → 直接使用 AT               │
│    else                          │
│      → 用 RT 调用 /refresh       │
│      → 保存新 RT，缓存新 AT      │
│      → 用新 AT 发起 API 调用     │
│                                  │
│  注意：                          │
│    - refresh 后旧 AT 立即失效    │
│    - 不要并发 refresh            │
│    - 不要缓存旧 RT              │
└──────────────────────────────────┘
```

## 7. 错误处理

| 错误码 | HTTP | 含义 | 客户端处理 |
|--------|------|------|-----------|
| `TOKEN_EXPIRED` | 401 | AT 已过期 | 用 RT refresh |
| `TOKEN_INVALID` | 401 | AT hash 不匹配（已被 refresh 替换） | 如果有新 AT 则用新 AT，否则用 RT refresh |
| `DELEGATE_REVOKED` | 401 | Delegate 已被撤销 | 重新登录获取新 root token |
| `DELEGATE_EXPIRED` | 401 | Delegate 已过期 | 联系父 delegate 续期或创建新 delegate |
| `REFRESH_FAILED` | 401 | RT hash 不匹配 | RT 已失效，重新登录 |
| `INVALID_TOKEN_FORMAT` | 400 | 字节长度不是 32 或 24 | 检查 token 是否完整 |
