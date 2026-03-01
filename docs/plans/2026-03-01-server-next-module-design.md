# server-next 模块架构设计

**日期**：2026-03-01  
**状态**：规划中  
**依据**：  
- [2026-03-01-requirements-use-cases.md](./2026-03-01-requirements-use-cases.md)  
- [2026-03-01-server-next-api-design.md](./2026-03-01-server-next-api-design.md)  
- [2026-03-01-derived-data-design.md](./2026-03-01-derived-data-design.md)  
- [2026-03-01-server-next-implementation.md](./2026-03-01-server-next-implementation.md)

本文档描述 `apps/server-next` 的模块划分、每个模块的职责与对外暴露的接口，以及模块间的依赖关系。

---

## 0. 全局约定

- 代码风格遵循 `docs/CODING-CONVENTIONS.md`：`type` 不用 `interface`，create 函数返回对象，path 用 `string`。
- 模块间通过 **依赖注入** 交互：`createApp(deps)` 在入口组装所有依赖，各层通过 `deps` 或闭包获取所需服务。
- 术语映射：代码中「Branch」= @casfa/realm 的 Delegate 实体（任务型分支）；「Delegate」= server-next 新增的长期授权（DelegateGrant）。

---

## 1. 分层概览

```
┌──────────────────────────────────────────────────────────┐
│  Entry (index.ts)                                        │
│  · 加载配置、组装依赖、启动 HTTP 服务                       │
├──────────────────────────────────────────────────────────┤
│  App (app.ts)                                            │
│  · createApp(deps)：挂载中间件、路由、错误处理               │
├──────────────────────────────────────────────────────────┤
│  Middleware                        Controllers            │
│  · auth.ts   — 鉴权              · files.ts — 文件       │
│  · realm.ts  — realmId 解析       · fs.ts    — 目录操作   │
│                                   · branches.ts          │
│                                   · delegates.ts         │
│                                   · realm.ts             │
│                                   · oauth.ts             │
├──────────────────────────────────────────────────────────┤
│  Services (业务逻辑)                                      │
│  · root-resolver.ts  — 当前根 & path 解析                 │
│  · file-service.ts   — 文件读写流（单 node 文件）          │
│  · fs-ops-service.ts — 目录操作                           │
│  · branch-service.ts — Branch 生命周期                    │
│  · delegate-service.ts — Delegate 授权管理                │
│  · realm-info-service.ts — Realm 信息 / usage / GC       │
│  · derived-data-service.ts — 派生数据计算与查询            │
├──────────────────────────────────────────────────────────┤
│  Stores (数据存取)                                        │
│  · delegate-grant-store.ts — 长期授权记录                 │
│  · derived-data-store.ts   — 派生数据缓存                 │
├──────────────────────────────────────────────────────────┤
│  External Packages                                       │
│  · @casfa/realm  (RealmFacade, DelegateStore)             │
│  · @casfa/cas    (CasFacade, CasStorage)                  │
│  · @casfa/core   (encoding, KeyProvider, topology)        │
│  · @casfa/fs     (FsService, tree/read/write ops)         │
│  · @casfa/delegate-token (token encode/decode/validate)   │
│  · @casfa/oauth-provider (可选复用或 mock)                 │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 共享类型 — `types.ts`

**职责**：定义贯穿全应用的共享类型，不含业务逻辑。

```typescript
// ── 权限 ──

/** Delegate 的细粒度权限（可配置） */
type DelegatePermission =
  | "file_read" | "file_write"
  | "branch_manage" | "delegate_manage"

/** Worker 的访问模式（读写粒度即可） */
type WorkerAccess = "readonly" | "readwrite"

// ── 认证上下文（Discriminated Union on `type`）──

/**
 * User：Realm 拥有者。
 * - 不携带 realmId：通过 userId 查询其绑定的 realm（当前 1:1）。
 * - 不携带 permissions：User 对自己的 realm 天然拥有全部权限。
 */
type UserAuth = {
  type: "user"
  userId: string
}

/**
 * Delegate：长期授权客户端/Agent，直接操作 Realm 当前根。
 * - 权限可配置，典型为「全权限减 delegate_manage」。
 */
type DelegateAuth = {
  type: "delegate"
  realmId: string
  delegateId: string
  clientId: string
  permissions: DelegatePermission[]
}

/**
 * Worker：持 Branch Token，在特定 Branch 上操作。
 * - 操作范围固定为：读文件、写文件、创建子 Branch、complete。
 * - 仅需区分 readonly / readwrite。
 */
type WorkerAuth = {
  type: "worker"
  realmId: string
  branchId: string
  access: WorkerAccess
}

type AuthContext = UserAuth | DelegateAuth | WorkerAuth

// ── Hono Env ──

type Env = {
  Variables: {
    auth: AuthContext
  }
}

// ── 统一错误响应 ──

type ErrorBody = {
  error: string
  message: string
}
```

使用方式：下游通过 `auth.type` 区分后，TypeScript 自动 narrow 出对应变体的字段：

```typescript
const auth = c.get("auth")

switch (auth.type) {
  case "user":
    auth.userId      // string
    // realmId 通过 userId 查询；权限天然全部拥有
    break
  case "delegate":
    auth.realmId     // string
    auth.delegateId  // string
    auth.clientId    // string
    auth.permissions // DelegatePermission[]
    break
  case "worker":
    auth.realmId     // string
    auth.branchId    // string
    auth.access      // "readonly" | "readwrite"
    break
}
```

---

## 3. 配置 — `config.ts`

**职责**：从环境变量加载运行时配置，输出强类型配置对象。

```typescript
type ServerConfig = {
  port: number
  storage: {
    type: "memory" | "fs" | "s3"
    fsPath?: string
  }
  auth: {
    jwtSecret?: string
    jwksUrl?: string
    maxBranchTtlMs: number
  }
}

// 暴露
function loadConfig(): ServerConfig
```

---

## 4. Stores（数据存取层）

### 4.1 DelegateGrantStore — `stores/delegate-grant-store.ts`

**职责**：存储和查询「长期授权 Delegate」记录。User 主动分配 token 或 OAuth 授权码流程产生的授权绑定在此。

```typescript
type DelegateGrant = {
  delegateId: string
  realmId: string
  clientId: string | null
  accessTokenHash: string
  refreshTokenHash: string | null
  permissions: Permission[]
  createdAt: number
  expiresAt: number | null
}

type DelegateGrantStore = {
  list(realmId: string): Promise<DelegateGrant[]>
  get(delegateId: string): Promise<DelegateGrant | null>
  getByAccessTokenHash(realmId: string, hash: string): Promise<DelegateGrant | null>
  insert(grant: DelegateGrant): Promise<void>
  remove(delegateId: string): Promise<void>
  updateTokens(delegateId: string, update: {
    accessTokenHash: string
    refreshTokenHash?: string
  }): Promise<void>
}

// 暴露
function createMemoryDelegateGrantStore(): DelegateGrantStore
```

### 4.2 DerivedDataStore — `stores/derived-data-store.ts`

**职责**：持久化 CAS 节点的派生数据 `(nodeKey, deriveKey) → data`。利用节点不可变性，数据永久有效。

```typescript
type DeriveKey =
  | "path_index"
  | "dir_entries"
  | "realm_stats"

type DerivedDataStore = {
  get<T = unknown>(nodeKey: string, deriveKey: DeriveKey): Promise<T | null>
  set(nodeKey: string, deriveKey: DeriveKey, data: unknown): Promise<void>
  has(nodeKey: string, deriveKey: DeriveKey): Promise<boolean>
  delete(nodeKey: string, deriveKey: DeriveKey): Promise<void>
}

// 暴露
function createMemoryDerivedDataStore(): DerivedDataStore
```

---

## 5. Services（业务逻辑层）

Services 封装与外部包的交互和业务规则，Controller 调用 Service、Service 调用 Store / 外部包。

### 5.1 RootResolver — `services/root-resolver.ts`

**职责**：  
1. 根据 AuthContext 获取「当前根 nodeKey」（Realm root 或 Branch root）。  
2. 将路径字符串解析为目标 nodeKey（优先查 `path_index` 派生数据，未命中则逐段 CAS 遍历）。

**依赖**：RealmFacade, CasFacade/FsService, DerivedDataStore

```typescript
type RootResolverDeps = {
  realmFacade: RealmFacade
  fsService: FsService
  derivedData: DerivedDataStore
}

type RootResolver = {
  /** 根据 auth 上下文获取当前根 nodeKey */
  getCurrentRoot(auth: AuthContext): Promise<string>

  /** 从 rootKey 出发，解析 path 到目标 nodeKey；null = 不存在 */
  resolvePath(rootKey: string, path: string): Promise<string | null>

  /** 组合：获取当前根 + 解析路径 */
  resolveFromAuth(auth: AuthContext, path: string): Promise<{
    rootKey: string
    nodeKey: string | null
  }>
}

function createRootResolver(deps: RootResolverDeps): RootResolver
```

### 5.2 FileService — `services/file-service.ts`

**职责**：  
1. 文件列表（list）：解析 path 到 dict nodeKey，返回子条目。  
2. 文件元数据（stat）：返回 kind、size、contentType。  
3. 文件下载（download）：读取单个 f-node 返回内容。  
4. 文件上传（upload）：接收 body，编码为单个 f-node，更新 dict 树后 commit 新根。

当前版本限制文件大小为单个 f-node 可存储的范围（**单 node 上限约 4MB**；文件内容刨除 header 后接近 4MB）。优先从 `dir_entries` 派生数据读取列表。

**依赖**：RootResolver, FsService (@casfa/fs), CasFacade, DerivedDataStore, RealmFacade

```typescript
// ── FileEntry（列表条目，discriminated union on `kind`）──

type FileEntryFile = {
  kind: "file"
  name: string
  nodeKey: string
  size: number
  contentType: string
}

type FileEntryDir = {
  kind: "dir"
  name: string
  nodeKey: string
  childCount: number
}

type FileEntry = FileEntryFile | FileEntryDir

// ── FileStat（单条目元数据，discriminated union on `kind`）──

type FileStatFile = {
  kind: "file"
  nodeKey: string
  size: number
  contentType: string
}

type FileStatDir = {
  kind: "dir"
  nodeKey: string
  childCount: number
}

type FileStat = FileStatFile | FileStatDir

type FileServiceDeps = {
  rootResolver: RootResolver
  fsService: FsService
  cas: CasFacade
  derivedData: DerivedDataStore
  realmFacade: RealmFacade
}

type FileService = {
  list(auth: AuthContext, path: string): Promise<FileEntry[]>
  stat(auth: AuthContext, path: string): Promise<FileStat>
  download(auth: AuthContext, path: string): Promise<{
    body: Uint8Array
    size: number
    contentType: string
  }>
  upload(auth: AuthContext, path: string, body: Uint8Array, contentType: string): Promise<{ nodeKey: string }>
}

function createFileService(deps: FileServiceDeps): FileService
```

### 5.3 FsOpsService — `services/fs-ops-service.ts`

**职责**：目录级操作 — mkdir、rm、mv、cp。每个操作都基于当前根 + 路径，操作 dict 树后 commit 新根。

**依赖**：RootResolver, FsService (@casfa/fs), RealmFacade

```typescript
type FsOpsServiceDeps = {
  rootResolver: RootResolver
  fsService: FsService
  realmFacade: RealmFacade
}

type FsOpsService = {
  mkdir(auth: AuthContext, path: string): Promise<void>
  rm(auth: AuthContext, path: string): Promise<void>
  mv(auth: AuthContext, from: string, to: string): Promise<void>
  cp(auth: AuthContext, from: string, to: string): Promise<void>
}

function createFsOpsService(deps: FsOpsServiceDeps): FsOpsService
```

### 5.4 BranchService — `services/branch-service.ts`

**职责**：  
1. 创建 Branch（在 Realm root 下或在现有 Branch 下创建子 Branch）。  
2. 列出 Branch。  
3. 撤销 Branch。  
4. Complete Branch（合并回 parent 并失效）。  
5. 签发 Branch token（调用 @casfa/delegate-token）。

server-next 的 Branch 对应 @casfa/realm 的 Delegate 实体。

**依赖**：RealmFacade (createChildDelegate, close), delegate-token

```typescript
type BranchInfo = {
  branchId: string
  realmId: string
  parentId: string | null
  mountPath: string
  expiresAt: number
  createdAt: number
}

type CreateBranchInput = {
  mountPath: string
  ttl: number
  parentBranchId?: string
}

type CreateBranchResult = {
  branchId: string
  accessToken: string
  expiresAt: number
}

type BranchServiceDeps = {
  realmFacade: RealmFacade
}

type BranchService = {
  create(auth: AuthContext, input: CreateBranchInput): Promise<CreateBranchResult>
  list(auth: AuthContext): Promise<BranchInfo[]>
  get(auth: AuthContext, branchId: string): Promise<BranchInfo | null>
  revoke(auth: AuthContext, branchId: string): Promise<void>
  complete(auth: AuthContext): Promise<void>
}

function createBranchService(deps: BranchServiceDeps): BranchService
```

### 5.5 DelegateService — `services/delegate-service.ts`

**职责**：  
1. 列出某 Realm 的长期授权 Delegate。  
2. 撤销 Delegate。  
3. 用户主动分配 token（assign）。

**依赖**：DelegateGrantStore

```typescript
type AssignInput = {
  clientId?: string
  permissions?: DelegatePermission[]
  ttl?: number
}

type AssignResult = {
  delegateId: string
  accessToken: string
  refreshToken?: string
  expiresAt: number | null
}

type DelegateServiceDeps = {
  delegateGrantStore: DelegateGrantStore
}

type DelegateService = {
  list(auth: AuthContext): Promise<DelegateGrant[]>
  revoke(auth: AuthContext, delegateId: string): Promise<void>
  assign(auth: AuthContext, input: AssignInput): Promise<AssignResult>
}

function createDelegateService(deps: DelegateServiceDeps): DelegateService
```

### 5.6 RealmInfoService — `services/realm-info-service.ts`

**职责**：  
1. 获取 Realm 摘要信息。  
2. 获取空间用量（优先查 `realm_stats` 派生数据）。  
3. 触发 GC。

**依赖**：RealmFacade, DerivedDataStore, RootResolver

```typescript
type UsageInfo = {
  nodeCount: number
  totalBytes: number
}

type RealmSummary = {
  realmId: string
  usage: UsageInfo
  lastGcTime: number | null
  branchCount: number
  delegateCount: number
}

type RealmInfoServiceDeps = {
  realmFacade: RealmFacade
  derivedData: DerivedDataStore
  rootResolver: RootResolver
  delegateGrantStore: DelegateGrantStore
}

type RealmInfoService = {
  summary(auth: AuthContext): Promise<RealmSummary>
  usage(auth: AuthContext): Promise<UsageInfo>
  gc(auth: AuthContext, cutOffTime: number): Promise<void>
}

function createRealmInfoService(deps: RealmInfoServiceDeps): RealmInfoService
```

### 5.7 DerivedDataService — `services/derived-data-service.ts`

**职责**：  
1. 封装「先查派生数据、未命中再计算并回填」的通用逻辑。  
2. 注册各 derive-function（path_index、dir_entries、realm_stats）。  
3. 为其他 Service 提供统一入口。

**依赖**：DerivedDataStore, CasFacade, KeyProvider

```typescript
type PathIndex = Record<string, string>
type DirEntryFile = { kind: "file"; name: string; nodeKey: string; size: number; contentType: string }
type DirEntryDir = { kind: "dir"; name: string; nodeKey: string; childCount: number }
type DirEntriesData = Array<DirEntryFile | DirEntryDir>
type RealmStatsData = { nodeCount: number; totalBytes: number }

type DerivedDataServiceDeps = {
  store: DerivedDataStore
  cas: CasFacade
  key: KeyProvider
}

type DerivedDataService = {
  /** 获取路径索引；未命中则从 rootKey 遍历计算并回填 */
  getPathIndex(rootKey: string): Promise<PathIndex>
  /** 获取目录子条目；未命中则解码 dict node 并回填 */
  getDirEntries(dictNodeKey: string): Promise<DirEntriesData>
  /** 获取 realm 统计；未命中则遍历计算并回填 */
  getRealmStats(rootKey: string): Promise<RealmStatsData>
}

function createDerivedDataService(deps: DerivedDataServiceDeps): DerivedDataService
```

---

## 6. Middleware

### 6.1 Auth Middleware — `middleware/auth.ts`

**职责**：  
1. 从 `Authorization: Bearer <token>` 提取 token。  
2. 判断 token 类型：含 `.` 视为 JWT/OAuth AT → 解析为 User 或 Delegate；否则视为 Branch Token → 解析为 Worker。  
3. 写入 `c.set("auth", authContext)` 供下游使用。  
4. 无 token 或校验失败返回 401。

**依赖**：DelegateGrantStore (判断 User vs Delegate), RealmFacade/DelegateStore (校验 Branch Token)

```typescript
type AuthMiddlewareDeps = {
  jwtVerifier: (token: string) => Promise<{ sub: string; client_id?: string }>
  delegateGrantStore: DelegateGrantStore
  delegateStore: DelegateStore
}

function createAuthMiddleware(deps: AuthMiddlewareDeps): MiddlewareHandler<Env>
```

**输出**：向 Hono Context 写入 `auth: AuthContext`。

### 6.2 Realm Middleware — `middleware/realm.ts`

**职责**：  
1. 读取 `c.req.param("realmId")`，若为 `"me"` 替换为 `auth.userId` 或 `auth.realmId`。  
2. 校验 param realmId 与 `auth.realmId` 一致，否则 403。

**依赖**：无（仅读 auth context）

```typescript
function createRealmMiddleware(): MiddlewareHandler<Env>
```

---

## 7. Controllers（HTTP 路由层）

Controllers 是**薄层**：解析请求参数 → 调用 Service → 格式化响应。不含业务逻辑。

### 7.1 FilesController — `controllers/files.ts`

| 方法 | 路径 | 说明 | 调用 Service |
|------|------|------|-------------|
| GET | `/api/realm/:realmId/files` | 根目录列表 | FileService.list |
| GET | `/api/realm/:realmId/files/*path` | 列表或下载（按 Accept / ?meta 区分） | FileService.list / download / stat |
| GET | `/api/realm/:realmId/files/*path?meta=1` | 文件元数据 | FileService.stat |
| PUT | `/api/realm/:realmId/files/*path` | 上传文件（单 node，≤ 4MB） | FileService.upload |

```typescript
function createFilesController(deps: { fileService: FileService }): Hono<Env>
```

### 7.2 FsController — `controllers/fs.ts`

| 方法 | 路径 | 说明 | 调用 Service |
|------|------|------|-------------|
| POST | `.../fs/mkdir` | 创建目录 | FsOpsService.mkdir |
| POST | `.../fs/rm` | 删除 | FsOpsService.rm |
| POST | `.../fs/mv` | 移动 | FsOpsService.mv |
| POST | `.../fs/cp` | 复制 | FsOpsService.cp |

```typescript
function createFsController(deps: { fsOpsService: FsOpsService }): Hono<Env>
```

### 7.3 BranchesController — `controllers/branches.ts`

| 方法 | 路径 | 说明 | 调用 Service |
|------|------|------|-------------|
| POST | `.../branches` | 创建 Branch | BranchService.create |
| GET | `.../branches` | 列出 Branch | BranchService.list |
| GET | `.../branches/:branchId` | Branch 详情 | BranchService.get |
| POST | `.../branches/:branchId/revoke` | 撤销 Branch | BranchService.revoke |
| POST | `.../branches/me/complete` | Complete 当前 Branch | BranchService.complete |

```typescript
function createBranchesController(deps: { branchService: BranchService }): Hono<Env>
```

### 7.4 DelegatesController — `controllers/delegates.ts`

| 方法 | 路径 | 说明 | 调用 Service |
|------|------|------|-------------|
| GET | `.../delegates` | 列出 Delegate | DelegateService.list |
| POST | `.../delegates/:delegateId/revoke` | 撤销 Delegate | DelegateService.revoke |
| POST | `.../delegates/assign` | 用户主动分配 | DelegateService.assign |

```typescript
function createDelegatesController(deps: { delegateService: DelegateService }): Hono<Env>
```

### 7.5 RealmController — `controllers/realm.ts`

| 方法 | 路径 | 说明 | 调用 Service |
|------|------|------|-------------|
| GET | `/api/realm/:realmId` | Realm 摘要 | RealmInfoService.summary |
| GET | `.../usage` | 空间用量 | RealmInfoService.usage |
| POST | `.../gc` | 触发 GC | RealmInfoService.gc |

```typescript
function createRealmController(deps: { realmInfoService: RealmInfoService }): Hono<Env>
```

### 7.6 OAuthController — `controllers/oauth.ts`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/.well-known/oauth-authorization-server` | OAuth 元数据 |
| GET | `/api/auth/authorize/info` | 授权页参数校验 |
| POST | `/api/auth/authorize` | 用户批准授权 |
| POST | `/api/auth/token` | Token 签发（authorization_code, refresh_token） |

```typescript
function createOAuthController(deps: {
  delegateGrantStore: DelegateGrantStore
  jwtSigner: (payload: Record<string, unknown>) => string
}): Hono<Env>
```

---

## 8. MCP — `mcp/handler.ts`

**职责**：  
1. 接收 MCP 协议请求（JSON-RPC over HTTP）。  
2. 利用 auth 上下文确定 realmId + scope。  
3. 将 MCP 工具调用转发到已有 Service（FileService、BranchService 等）。  
4. 序列化为 MCP 响应。

**依赖**：FileService, FsOpsService, BranchService

```typescript
type McpHandlerDeps = {
  fileService: FileService
  fsOpsService: FsOpsService
  branchService: BranchService
}

function createMcpHandler(deps: McpHandlerDeps): Hono<Env>
```

MCP 暴露的 Tool 列表（初期）：

| MCP Tool | 映射到 |
|----------|--------|
| `list_files` | FileService.list |
| `read_file` | FileService.download |
| `write_file` | FileService.upload |
| `file_info` | FileService.stat |
| `mkdir` | FsOpsService.mkdir |
| `rm` | FsOpsService.rm |
| `mv` | FsOpsService.mv |
| `cp` | FsOpsService.cp |
| `create_branch` | BranchService.create |
| `complete_branch` | BranchService.complete |

---

## 9. App 入口 — `app.ts` + `index.ts`

### 9.1 `app.ts`

**职责**：接收所有依赖，组装 Hono 应用——挂中间件、挂路由、配错误处理。

```typescript
type AppDeps = {
  config: ServerConfig
  cas: CasFacade
  realmFacade: RealmFacade
  delegateStore: DelegateStore
  delegateGrantStore: DelegateGrantStore
  derivedDataStore: DerivedDataStore
  key: KeyProvider
  fsService: FsService
}

function createApp(deps: AppDeps): Hono<Env>
```

内部流程：
1. 创建各 Service（createRootResolver, createFileService, ...）。
2. 创建各 Controller。
3. 挂 CORS。
4. 挂 auth middleware → realm middleware → controllers。
5. 挂 health/info（无需 auth）。
6. 挂 OAuth（无需 realm）。
7. 挂 MCP。
8. 挂 404 / onError。

### 9.2 `index.ts`

**职责**：程序入口——加载配置、实例化底层依赖（CAS storage、RealmFacade 等）、调用 createApp、启动 Bun HTTP 服务。

```typescript
const config = loadConfig()
const storage = createStorage(config.storage)        // memory | fs | s3
const key = createKeyProvider()                       // @casfa/core
const cas = createCasFacade({ storage, key })
const delegateStore = createMemoryDelegateStore()
const realmFacade = createRealmFacade({ cas, delegateStore, key })
const delegateGrantStore = createMemoryDelegateGrantStore()
const derivedDataStore = createMemoryDerivedDataStore()
const fsService = createFsService({ ctx: { storage, key } })

const app = createApp({
  config, cas, realmFacade, delegateStore,
  delegateGrantStore, derivedDataStore, key, fsService,
})

Bun.serve({ port: config.port, fetch: app.fetch })
```

---

## 10. 模块依赖图

```
index.ts
  └─ app.ts
       ├─ middleware/auth.ts ──── DelegateGrantStore, DelegateStore
       ├─ middleware/realm.ts
       │
       ├─ controllers/files.ts ──── FileService
       ├─ controllers/fs.ts ────── FsOpsService
       ├─ controllers/branches.ts ─ BranchService
       ├─ controllers/delegates.ts ─ DelegateService
       ├─ controllers/realm.ts ──── RealmInfoService
       ├─ controllers/oauth.ts ──── DelegateGrantStore
       │
       └─ mcp/handler.ts ───────── FileService, FsOpsService, BranchService

Services 之间的依赖:

  DerivedDataService ──── DerivedDataStore, CasFacade, KeyProvider
         ▲
         │
  RootResolver ────────── RealmFacade, FsService, DerivedDataService
         ▲
     ┌───┴──────────┐
     │              │
  FileService   FsOpsService
     │
     ├── CasFacade
     ├── DerivedDataService
     └── RealmFacade

  BranchService ───── RealmFacade
  DelegateService ─── DelegateGrantStore
  RealmInfoService ── RealmFacade, DerivedDataService, DelegateGrantStore
```

---

## 11. 目录结构

```
apps/server-next/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   # 入口：加载配置、组装依赖、启动服务
│   ├── app.ts                     # createApp：组装中间件 + 路由
│   ├── types.ts                   # AuthContext, Env, Permission, ErrorBody
│   ├── config.ts                  # loadConfig
│   │
│   ├── stores/
│   │   ├── delegate-grant-store.ts   # DelegateGrantStore 接口 + 内存实现
│   │   └── derived-data-store.ts     # DerivedDataStore 接口 + 内存实现
│   │
│   ├── services/
│   │   ├── root-resolver.ts          # getCurrentRoot, resolvePath
│   │   ├── file-service.ts           # list, stat, download, upload
│   │   ├── fs-ops-service.ts         # mkdir, rm, mv, cp
│   │   ├── branch-service.ts         # create, list, revoke, complete
│   │   ├── delegate-service.ts       # list, revoke, assign
│   │   ├── realm-info-service.ts     # summary, usage, gc
│   │   └── derived-data-service.ts   # getPathIndex, getDirEntries, getRealmStats
│   │
│   ├── middleware/
│   │   ├── auth.ts                   # Bearer 解析 → AuthContext
│   │   └── realm.ts                  # realmId 参数解析与校验
│   │
│   ├── controllers/
│   │   ├── files.ts                  # GET/PUT /files/*path
│   │   ├── fs.ts                     # POST /fs/mkdir|rm|mv|cp
│   │   ├── branches.ts              # CRUD /branches
│   │   ├── delegates.ts             # CRUD /delegates
│   │   ├── realm.ts                 # GET /realm/:realmId, /usage, POST /gc
│   │   └── oauth.ts                 # /.well-known/*, /api/auth/*
│   │
│   └── mcp/
│       └── handler.ts                # MCP JSON-RPC handler
│
└── tests/
    ├── middleware/
    │   └── auth.test.ts
    ├── services/
    │   ├── root-resolver.test.ts
    │   ├── file-service.test.ts
    │   └── ...
    └── controllers/
        └── ...
```
