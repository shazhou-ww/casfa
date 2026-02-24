# Root Delegate 多设备问题：JWT 直通方案

## 问题

当前 root delegate 沿用了与 child delegate 相同的 AT/RT 机制——Delegate 实体上只存一对 `currentRtHash` / `currentAtHash`。每次调用 `POST /api/tokens/root` 都通过 `rotateTokens()` 原子替换 hash，导致之前的 AT/RT 立即失效。

设计文档里的假设是 *"一个 Delegate = 一个客户端会话"*。这对 child delegate 成立（每个 IDE/CLI 实例有独立的 child delegate），但对 root 不成立——root 代表的是**用户在此 realm 的身份锚点**，而非单一设备会话。

**后果**：用户从设备 A 登录后，在设备 B 再次 `POST /api/tokens/root`，设备 A 的 AT/RT 立即失效。客户端会在下次 API 调用时收到 `TOKEN_INVALID`，触发 refresh 失败，最终掉线。

## 方案：Root 操作直接使用 JWT

Root delegate 不再持有 AT/RT，变为纯粹的 delegate 树锚点。所有原来需要 root AT 的操作改用用户的 OAuth JWT 鉴权。

- root delegate 仍作为 Delegate 实体存在（`depth=0`，`parentId=null`），保持 delegate 树完整性
- root delegate 的 `currentRtHash`、`currentAtHash`、`atExpiresAt` 字段置空，不再写入
- child delegate 的 AT/RT 机制完全不受影响

### 优点

| 维度 | 说明 |
|---|---|
| 多设备并发 | JWT 无状态，多设备同时使用不冲突 |
| 改动最小 | 复用现有 JWT 中间件，不引入新的 token 格式 |
| 语义清晰 | root = 用户身份，用 JWT 鉴权天然对应；child = 会话，继续用 AT/RT |

## 服务端改动

### 1. 统一鉴权中间件（核心改动）

当前 `accessTokenMiddleware` 只接受 32 字节 AT。改造为**同时支持 JWT 和 AT 两种 Bearer token**，通过 token 格式自动区分。

判断依据很简单：

- AT 是 32 字节 binary 的 base64（固定 44 字符，`=` padding）
- JWT 是 `header.payload.signature` 格式（含 `.` 分隔符）

```
Authorization: Bearer <base64-AT>    → 走 AT 验证路径
Authorization: Bearer <JWT>           → 走 JWT 验证路径
```

#### `access-token-auth.ts` — 改造伪代码

```typescript
export const createAccessTokenMiddleware = (deps) => {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    // ... extract token string ...

    // ── 区分 token 类型 ──
    if (tokenString.includes(".")) {
      // JWT path: 复用 jwtAuthMiddleware 的验证逻辑
      const jwtPayload = await verifyJwt(tokenString);
      const user = await usersDb.get(jwtPayload.sub);

      // 查找该用户的 root delegate（GSI1 按 realm 查询，depth=0）
      const rootDelegate = await delegatesDb.getRootByRealm(user.userId);
      if (!rootDelegate || rootDelegate.isRevoked) {
        return c.json({ error: "ROOT_DELEGATE_NOT_FOUND" }, 401);
      }

      // 构造与 AT 路径相同形状的 AuthContext
      const auth: AccessTokenAuthContext = {
        type: "access",
        tokenBytes: new Uint8Array(0), // JWT 无 token bytes
        delegate: rootDelegate,
        delegateId: rootDelegate.delegateId,
        realm: rootDelegate.realm,
        canUpload: rootDelegate.canUpload,
        canManageDepot: rootDelegate.canManageDepot,
        issuerChain: rootDelegate.chain,
      };
      c.set("auth", auth);
      return next();
    }

    // AT path: 原有逻辑不变
    // ... decode 32-byte AT, verify hash, check expiry ...
  };
};
```

**关键设计决策**：JWT 路径也构造 `AccessTokenAuthContext`（`type: "access"`），而非新增一个 `type: "jwt-root"` 类型。这样下游所有中间件（`realmAccessMiddleware`、`canUploadMiddleware`、`canManageDepotMiddleware`、`proofValidationMiddleware`）和所有 controller **零改动**。

#### 依赖注入调整

`createAccessTokenMiddleware` 的 deps 需要额外传入：

```typescript
export type AccessTokenMiddlewareDeps = {
  delegatesDb: DelegatesDb;
  // ── 新增 ──
  jwtVerify: (token: string) => Promise<JwtPayload>; // 复用 jwt-auth.ts 的验证函数
  usersDb: UsersDb;                                   // 查角色用，判 authorized
};
```

不需要创建新的中间件，router.ts 中所有挂 `accessTokenMiddleware` 的路由自动获得 JWT 支持。

### 2. `POST /api/tokens/root` — 精简

不再返回 RT/AT，只确保 root delegate 实体存在并返回元数据。

```
POST /api/tokens/root
Authorization: Bearer <JWT>
Body: { "realm": "usr_xxx" }

Response 200/201:
{
  "delegate": {
    "delegateId": "dlt_xxx",
    "realm": "usr_xxx",
    "depth": 0,
    "canUpload": true,
    "canManageDepot": true,
    "createdAt": 1707700000000
  }
}
```

不再调用 `generateTokenPair()`，不再调用 `rotateTokens()`。`getOrCreateRoot()` 也不再需要 token hash 参数。

### 3. `POST /api/tokens/refresh` — 仅限 child delegate

在 refresh controller 中加一个检查：

```typescript
if (delegate.depth === 0) {
  return c.json({
    error: "ROOT_REFRESH_NOT_ALLOWED",
    message: "Root delegate uses JWT authentication directly"
  }, 400);
}
```

### 4. Delegate 实体变更

Root delegate 的 `currentRtHash`、`currentAtHash`、`atExpiresAt` 字段置为 `null`（或空字符串）。需要一个简单的数据迁移，清除现有 root delegate 上的 hash 字段。

仅影响 `depth === 0` 的记录。

### 5. 受影响 API 汇总

| 端点 | 改动 |
|---|---|
| `POST /api/tokens/root` | 不再返回 RT/AT，仅返回 delegate 元数据 |
| `POST /api/tokens/refresh` | 拒绝 `depth=0` 的 delegate |
| `accessTokenMiddleware` | 扩展支持 JWT Bearer，JWT→root delegate→AuthContext |
| 所有 `/api/realm/:realmId/*` 路由 | **零改动**（中间件透明处理） |
| `realmAccessMiddleware` | **零改动**（已支持 `auth.realm` 比较） |
| `canUploadMiddleware` / `canManageDepotMiddleware` | **零改动** |
| `proofValidationMiddleware` | **零改动** |
| 所有 Controller | **零改动** |

## 客户端改动（`@casfa/client`）

### 1. 认证模式切换

客户端需要支持两种 auth 模式：

- **JWT 模式**（root 级操作）：直接把 OAuth JWT 放入 `Authorization: Bearer` 头
- **AT 模式**（child delegate 操作）：行为不变

核心改动在 `TokenSelector`——不再需要 `ensureRootDelegate()` 去获取 AT，而是区分 "我是 root 用户直接操作" vs "我是通过 child delegate 操作"。

### 2. `TokenSelector` 改造

```typescript
export type TokenSelector = {
  /**
   * 获取 realm 操作的 auth header。
   *
   * 策略：
   * - 如果有 child delegate 的有效 AT → 用 AT
   * - 否则如果有有效 JWT → 用 JWT（root 模式）
   * - 否则 → null（需要重新登录）
   */
  ensureAuthHeader: () => Promise<string | null>;

  /**
   * 获取 Access Token（仅 child delegate 场景）。
   * 保留给需要 token bytes 的操作（如 PoP 计算）。
   */
  ensureAccessToken: () => Promise<StoredAccessToken | null>;

  /** 确保 root delegate 实体存在（仅获取元数据，不获取 token） */
  ensureRootDelegate: () => Promise<StoredRootDelegate | null>;
};
```

默认场景（用户直接登录使用）：`ensureAuthHeader()` 发现没有 child delegate，直接返回 `Bearer <JWT>`。不再去调 `/api/tokens/root` 获取 AT。

### 3. `StoredRootDelegate` 类型变更

RT/AT 字段变为可选：

```typescript
export type StoredRootDelegate = {
  delegateId: string;
  realm: string;
  depth: number;
  canUpload: boolean;
  canManageDepot: boolean;

  // ── 以下字段移除 ──
  // refreshToken: string;
  // accessToken: string;
  // accessTokenExpiresAt: number;
};
```

### 4. `withAccessToken` → `withAuth` 泛化

现在 `delegates.ts`、`nodes.ts`、`filesystem.ts` 等 client 模块都通过 `withAccessToken` 确保有 AT 再发请求。改造为 `withAuth`，支持 JWT 和 AT 两种方式：

```typescript
// helpers.ts
export const withAuth = (
  getAuthHeader: () => Promise<string | null>,
  error = ERRORS.ACCESS_REQUIRED
) => {
  return <R>(fn: (authHeader: string) => Promise<FetchResult<R>>): Promise<FetchResult<R>> =>
    getAuthHeader().then((header) =>
      header ? fn(header) : Promise.resolve({ ok: false as const, error })
    );
};
```

对应的 API 函数签名从 `(baseUrl, realm, tokenBase64, ...)` 改为 `(baseUrl, realm, authHeader, ...)`，auth header 已经是完整的 `Bearer xxx` 字符串。

### 5. 客户端 API 调用改造示例

```typescript
// client/delegates.ts — 改造前
export const createDelegateMethods = ({ baseUrl, realm, tokenSelector }) => {
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());
  return {
    create: (params) =>
      requireAccess((t) => api.createDelegate(baseUrl, realm, t.tokenBase64, params)),
    // ...
  };
};

// client/delegates.ts — 改造后
export const createDelegateMethods = ({ baseUrl, realm, tokenSelector }) => {
  const requireAuth = withAuth(() => tokenSelector.ensureAuthHeader());
  return {
    create: (params) =>
      requireAuth((auth) => api.createDelegate(baseUrl, realm, auth, params)),
    // ...
  };
};
```

### 6. PoP（Proof of Possession）注意事项

当前 PoP 计算依赖 `tokenBytes`（AT 的原始字节）。在 JWT 模式下没有 AT bytes。

需要确认 PoP 中间件在 JWT 模式下的行为。从 router.ts 看，`proofValidationMiddleware` 挂在 node GET/stat/read/ls 及 fs write/mkdir/rm/mv/cp/rewrite 上。如果 root 用户（JWT 模式）也需要 PoP 验证，需要先创建一个 child delegate。

**建议**：root JWT 模式跳过 PoP 验证（root 已是最高权限，PoP 主要用于 child delegate 的粒度授权）。具体来说，在 `proofValidationMiddleware` 中检查 `auth.tokenBytes.length === 0` 时跳过验证。

### 7. 客户端改动文件清单

| 文件 | 改动 |
|---|---|
| `types/tokens.ts` | `StoredRootDelegate` 移除 RT/AT 字段 |
| `store/token-selector.ts` | 新增 `ensureAuthHeader()`，不再自动创建 root token |
| `store/token-checks.ts` | 移除 `isAccessTokenValid(rootDelegate)` 相关检查 |
| `client/helpers.ts` | 新增 `withAuth`，保留 `withAccessToken`（仅 child delegate 用） |
| `client/delegates.ts` | `withAccessToken` → `withAuth` |
| `client/nodes.ts` | `withAccessToken` → `withAuth` |
| `client/filesystem.ts` | `withAccessToken` → `withAuth` |
| `client/depots.ts` | `withAccessToken` → `withAuth` |
| `client/tokens.ts` | `createRoot` 不再返回 RT/AT |
| `client/index.ts` | 移除 `getAccessToken`（或改为 `getAuthHeader`） |
| `api/tokens.ts` | `createRootToken` 响应类型变更 |
| `utils/http.ts` | 无改动 |

## 迁移

### 服务端

1. 部署新版中间件（同时支持 JWT 和 AT）
2. `POST /api/tokens/root` 改为新版（只返回元数据）
3. 清除已有 root delegate 的 hash 字段（一次性脚本）

步骤 1 先上线后，新旧客户端都能正常工作：
- 旧客户端继续用 root AT → 中间件 AT 路径处理
- 新客户端用 JWT → 中间件 JWT 路径处理

步骤 2 上线后，旧客户端调 `/api/tokens/root` 不再收到 RT/AT，会走 ensureAccessToken 失败，触发重新登录流程 → 用户更新客户端即可。

### 客户端

1. `TokenSelector` 新增 `ensureAuthHeader()`，优先用 child delegate AT，fallback 到 JWT
2. 所有 client 模块切换到 `withAuth`
3. 发布新版客户端

## 未解决问题

### JWT 过期续期

OAuth JWT 通常 1 小时过期。客户端已有 `RefreshManager` 做 proactive refresh（过期前 5 分钟自动续期），这个机制继续工作。唯一区别是现在 JWT 不仅用于 `POST /api/tokens/root`，还直接用于所有 realm API 调用——如果 JWT 过期，realm 操作会失败。

`RefreshManager` 的 proactive refresh 可覆盖大部分场景。极端情况下（refresh 失败），客户端触发 `onAuthRequired` 回调要求用户重新登录。

### 服务端撤销

JWT 无法即时服务端撤销（除非加黑名单）。但：
- OAuth provider 撤销后，JWT 最晚 1 小时过期
- 撤销 root delegate 会级联撤销所有 child delegate
- 管理员可以通过 admin API 改用户角色为 `unauthorized`，JWT 中间件会拒绝
