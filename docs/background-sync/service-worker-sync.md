# Service Worker Client

> 将 CasfaClient 运行在 Service Worker 中，统一 token 管理、网络 I/O 与后台同步。

## 动机

1. **Token 管理分散**：每个 Tab 各自持有 CasfaClient，各自 refresh JWT，产生并发 race
2. **网络 I/O 阻塞 UI**：`flush()` 期间批量 `checkMany` + `put` + `claim` 在主线程 `fetch()`
3. **页面关闭 = 同步中断**：pending 数据在 IndexedDB，上传必须等下次打开页面
4. **多 Tab 重复请求**：每个 Tab 各自 flush / commit

`@casfa/client` 完全兼容 SW 环境（零 DOM 依赖），可以整体移入 Service Worker。

## 架构

```
┌───────────────────────────────────────────────┐
│  Main Thread (per Tab)                        │
│                                               │
│  const client = await createAppClient(config) │
│  client.depots.list()   ← RPC 透明            │
│  client.scheduleCommit()                      │
│                                               │
│  CachedStorage (IndexedDB)                    │
│    put() → cache + pendingKeys                │
│    get() → cache hit ? return : client.get()  │
└──────────────┬────────────────────────────────┘
               │ MessagePort (RPC, per Tab)
               │ BroadcastChannel (events, all Tabs)
┌──────────────▼────────────────────────────────┐
│  Service Worker (单实例)                       │
│                                               │
│  client: CasfaClient (单实例，JWT 鉴权)        │
│  所有 port 共享同一 client                     │
│                                               │
│  JWT 直通 → root 权限访问 API                  │
│  SW 自治 JWT refresh                           │
│                                               │
│  SyncCoordinator                              │
│    Layer 1: pending CAS → check/put/claim     │
│    Layer 2: depot-queue → get/commit          │
└───────────────────────────────────────────────┘
```

## 单 Client 模型

Root 直接使用 JWT 访问 API（见 `root-delegate-jwt-auth.md`），不再持有 delegate AT/RT。
SW 只需维护**一个** CasfaClient 实例，绑定用户的 JWT，代表 root 权限。

- 所有 Tab 通过 `MessagePort` 连接 SW，共享同一 CasfaClient
- 调用方拿到的 client 对象内部透明路由到 SW（或直连，降级模式）
- JWT refresh 由 SW 内的 `RefreshManager` 自治管理
- bridge 是内部传输层实现，不暴露给调用方

SW 内部结构：

```typescript
let client: CasfaClient | null = null;
```

## 接口

调用方只接触一个统一类型 `AppClient`，不感知底层是 SW RPC 还是主线程直连。

```typescript
/**
 * CasfaClient + 同步 + 鉴权管理。
 * 两种构造方式返回相同接口，调用方无需感知底层传输方式。
 */
type AppClient = CasfaClient & {
  /**
   * 推送 user JWT。创建/覆盖底层 CasfaClient，自治 refresh。
   * 重复调用覆盖旧 token（re-login）。
   */
  setUserToken(token: StoredUserToken): Promise<void>;

  // ── Sync ──

  scheduleCommit(depotId: string, newRoot: string, lastKnownServerRoot: string | null): void;
  getPendingRoot(depotId: string): Promise<string | null>;
  flushNow(): Promise<void>;

  // ── 事件 ──

  onSyncStateChange(fn: (state: SyncState) => void): () => void;
  onConflict(fn: (event: ConflictEvent) => void): () => void;
  onSyncError(fn: (event: SyncErrorEvent) => void): () => void;
  onCommit(fn: (event: SyncCommitEvent) => void): () => void;

  /** flush pending sync → logout → 清理资源 */
  logout(): Promise<void>;
  dispose(): void;
};
```

`AppClient` 是 `CasfaClient` 的超集（intersection type）。所有 `CasfaClient` 方法（`oauth`、`tokens`、`delegates`、`depots`、`fs`、`nodes`、`getState`、`getServerInfo` 等）直接在 `AppClient` 上调用。

### 构造

```typescript
type AppClientConfig = {
  baseUrl: string;
  realm: string;
  swUrl?: string | URL;            // 默认 "/sw.js"，仅 SW 模式
  rpcTimeoutMs?: number;           // 默认 30_000，仅 SW 模式
  syncDebounceMs?: number;         // 默认 2_000
};

/** SW 模式 — CasfaClient API 通过 RPC 路由到 SW */
function createSWClient(config: AppClientConfig): Promise<AppClient>;

/** 直连模式 — CasfaClient 在主线程直接运行 */
function createDirectClient(config: AppClientConfig): Promise<AppClient>;

/** 自动选择：SW 可用走 SW，否则降级直连 */
async function createAppClient(config: AppClientConfig): Promise<AppClient> {
  if ("serviceWorker" in navigator) {
    try {
      return await createSWClient(config);
    } catch {
      console.warn("SW registration failed, falling back to direct mode");
    }
  }
  return createDirectClient(config);
}
```

### 使用示例

```typescript
// 初始化 — 调用方不关心底层走 SW 还是直连
const client = await createAppClient({ baseUrl: "", realm });

// OAuth 登录后
await client.setUserToken(userJWT);

// CasfaClient API — 直接调用，透明路由
const depots = await client.depots.list();
const result = await client.fs.write(rootKey, path, data);

// Sync — 同一对象上的方法
if (result.ok) {
  client.scheduleCommit(depotId, result.data.newRoot, lastKnownServerRoot);
}

// 事件
const off = client.onSyncStateChange((state) => console.log(state));
```

### CasfaClient（不变）

底层核心类型，`AppClient` 通过 intersection 扩展它：

```typescript
type CasfaClient = {
  getState():      TokenState;
  getServerInfo(): ServiceInfo | null;
  setRootDelegate(delegate: StoredRootDelegate): void;
  getAccessToken(): Promise<StoredAccessToken | null>;
  logout():        void;

  oauth:      OAuthMethods;        // getConfig, login, exchangeCode, getMe
  tokens:     TokenMethods;        // createRoot, refresh
  delegates:  DelegateMethods;     // create, list, get, revoke, claimNode
  depots:     DepotMethods;        // create, list, get, update, delete, commit
  fs:         FsMethods;           // stat, ls, read, write, mkdir, rm, mv, cp, rewrite
  nodes:      NodeMethods;         // get, getMetadata, check, put, claim
};

type FetchResult<T> =
  | { ok: true;  data: T; status: number }
  | { ok: false; error: ClientError };
```

## 消息协议

### 设计原则

1. **RPC 用 `MessagePort`** — 点对点、Transferable、不广播
2. **事件用 `BroadcastChannel("casfa")`** — sync 状态需通知所有 Tab
3. **单 client** — 所有 port 共享，RPC 直接路由到唯一 client

### 主线程 → SW（MessagePort）

```typescript
/** 连接握手（通过 SW.postMessage，附带 MessagePort） */
type ConnectMessage = {
  type: "connect";
  port: MessagePort;               // transfer
};

/** 设置 user JWT（RPC） */
type SetUserTokenMessage = {
  type: "set-user-token";
  id: number;
  token: StoredUserToken;
};

/** RPC 调用：路由到单一 client */
type RPCRequest = {
  type: "rpc";
  id: number;
  target: "oauth" | "tokens" | "delegates" | "depots" | "fs" | "nodes" | "client";
  method: string;
  args: unknown[];
};

/** Sync 控制 */
type ScheduleCommitMessage = {
  type: "schedule-commit";
  depotId: string;
  targetRoot: string;
  lastKnownServerRoot: string | null;
};

type GetPendingRootMessage = {
  type: "get-pending-root";
  id: number;
  depotId: string;
};

type FlushNowMessage = {
  type: "flush-now";
  id: number;
};

type LogoutMessage = {
  type: "logout";
  id: number;
};

type MainToSWMessage =
  | ConnectMessage
  | SetUserTokenMessage
  | RPCRequest
  | ScheduleCommitMessage
  | GetPendingRootMessage
  | FlushNowMessage
  | LogoutMessage;
```

### SW → 主线程（MessagePort 回复）

```typescript
type RPCResponse = {
  type: "rpc-response";
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
};

/** connect 的回复 — 同步初始状态 */
type ConnectAckMessage = {
  type: "connect-ack";
  syncState: SyncState;
  pendingCount: number;
  authenticated: boolean;
};
```

### SW → 所有 Tab（BroadcastChannel "casfa"）

```typescript
type BroadcastMessage =
  | { type: "sync-state";    payload: SyncState }
  | { type: "conflict";      payload: ConflictEvent }
  | { type: "sync-error";    payload: SyncErrorEvent }
  | { type: "commit";        payload: SyncCommitEvent }
  | { type: "pending-count"; payload: number }
  | { type: "auth-required" };       // 所有 token refresh 失败
```

### Transferable

| 方向 | 场景 | Transfer |
|------|------|----------|
| Main → SW | `nodes.put(key, content)` | `content.buffer` |
| Main → SW | `fs.write(root, path, data)` | `data.buffer` |
| SW → Main | `nodes.get()` → `Uint8Array` | `data.buffer` |

proxy 自动扫描 args 中的 `Uint8Array`，提取 `buffer` 作为 transferable。

> **注意**：Transfer 后原线程的 `ArrayBuffer` 被 detach（长度变 0）。
> 调用方在发送后不可再访问原 buffer。如需保留，应在调用前 `slice()`。

### 消息往返

#### 1. 连接 + Token

```
Tab                                    SW
 │                                      │
 │── sw.postMessage({ type: "connect",  │
 │     port: port2 }, [port2])  ──────→│  ports.add(port)
 │                                      │
 │←── port.postMessage({                │
 │     type: "connect-ack",             │
 │     syncState, pendingCount,         │
 │     authenticated })  ──────────────│
 │                                      │
 │── port.postMessage({                 │
 │     type: "set-user-token",          │
 │     id: 1, token })  ─────────────→│  IndexedDB 存储
 │                                      │  创建 CasfaClient（JWT 鉴权）
 │                                      │  此后自治 refresh JWT
 │←── { type: "rpc-response",          │
 │     id: 1, result: null }  ─────────│
```

#### 2. RPC：nodes.get

```
Tab                                    SW
 │                                      │
 │── port.postMessage({                 │
 │     type: "rpc", id: 2,             │
 │     target: "nodes",                 │
 │     method: "get",                   │
 │     args: ["0a1b..."] })  ────────→│  result = await client.nodes.get(...)
 │                                      │   (JWT 过期 → 自动 refresh)
 │←── port.postMessage({                │
 │     type: "rpc-response", id: 2,     │
 │     result: { ok: true,              │
 │       data: Uint8Array } },          │
 │     [data.buffer])  ← Transfer ────│
```

#### 3. Sync

```
Tab                                    SW
 │                                      │
 │── port.postMessage({                 │
 │     type: "schedule-commit",         │
 │     depotId: "d_1",                  │
 │     targetRoot: "0xabc",             │
 │     lastKnownServerRoot: "0x789"     │
 │   })  ──────────────────────────→│  enqueue(depotId, targetRoot)
 │                                      │  debounce 2s
 │                                      │
 │                                      │  runSync():
 │                                      │    用 client flush CAS nodes
 │                                      │    用 client commit depot
 │                                      │
 │←── BroadcastChannel ──────────────│
 │     { type: "commit",               │
 │       event: { depotId,              │
 │                committedRoot } }     │
 │                                      │
Tab₂ ←── (也收到)  ──────────────────│
```

> MessagePort 保证消息 FIFO。

#### 4. Token Refresh 失败

```
                                       SW
                                        │
                                        │  JWT refresh → 401
                                        │  所有重试失败
                                        │
Tab₁ ←── BroadcastChannel ───────────│
Tab₂ ←── { type: "auth-required" }  ──│

Tab₁ or Tab₂: redirect /login
```

### RPC 超时

```typescript
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

function createRPC(port: MessagePort, timeoutMs: number) {
  let requestId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  port.addEventListener("message", (e: MessageEvent<RPCResponse>) => {
    if (e.data.type !== "rpc-response") return;
    const cb = pending.get(e.data.id);
    if (!cb) return;
    pending.delete(e.data.id);
    if (e.data.error) cb.reject(new Error(e.data.error.message));
    else cb.resolve(e.data.result);
  });

  /** 所有带 id 字段的消息的 union（去掉 id，由 rpc 自动分配） */
  type RPCMessage = Omit<
    | SetUserTokenMessage
    | RPCRequest
    | GetPendingRootMessage
    | FlushNowMessage
    | LogoutMessage,
    "id"
  >;

  return function rpc(msg: RPCMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${msg.type}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });

      const transferables = "args" in msg ? extractTransferables(msg.args) : [];
      port.postMessage({ ...msg, id }, transferables);
    });
  };
}
```

## 拆包

### 目标

SW 入口是薄壳（事件布线）。核心逻辑在独立 package 中，可单独测试、可被 CLI 复用。主线程 bundle 和 SW bundle 互不包含对方的运行时代码。

### Package 结构

```
packages/
  client/                          # @casfa/client (不变)
    src/
      client/                      #   CasfaClient 实现
      api/                         #   API 请求函数
      store/                       #   TokenStore, RefreshManager, TokenSelector
      types/                       #   Token 类型
      utils/                       #   fetchApi, fetchWithAuth

  client-bridge/                   # @casfa/client-bridge (新建)
    src/
      types.ts                     #   AppClient, AppClientConfig, 所有消息类型
      sw-client.ts                 #   createSWClient (内部 proxy + RPC)
      direct-client.ts             #   createDirectClient (内部 CasfaClient + SyncManager)
      _proxy.ts                    #   createClientProxy (内部实现)
      _rpc.ts                      #   createRPC (内部实现)
      index.ts                     #   export { createAppClient, AppClient, AppClientConfig }

  client-sw/                       # @casfa/client-sw (新建)
    src/
      message-handler.ts           #   onMessage 分发
      token-storage-idb.ts         #   IndexedDB TokenStorageProvider
      index.ts

  explorer/                        # @casfa/explorer (已有，扩展)
    src/
      core/
        sync-manager.ts            #   SyncManager (不变，降级用)
        sync-coordinator.ts        #   SyncCoordinator (新建，SW 环境用)
```

`_proxy.ts` / `_rpc.ts` 以 `_` 前缀标记为内部模块，不从 package 入口导出。

### SW 入口

```
apps/server/frontend/
  src/
    sw/
      sw.ts                        # 薄壳
    lib/
      client.ts                    # createAppClient(config) 工厂
```

### 依赖关系

```
apps/server/frontend (主线程 bundle)
  └─ @casfa/client-bridge
       ├─ (types only) @casfa/client
       └─ (dynamic) @casfa/client       ← DirectClient 降级时才 import

apps/server/frontend (SW bundle: sw.ts)
  ├─ @casfa/client-sw
  │    └─ @casfa/client                  ← 单实例
  └─ @casfa/explorer (SyncCoordinator)
```

| Bundle | 包含 | 不包含 |
|--------|------|--------|
| 主线程 | `@casfa/client-bridge` (proxy + factory) | `@casfa/client`¹, `@casfa/client-sw` |
| SW | `@casfa/client`, `@casfa/client-sw`, `SyncCoordinator` | `@casfa/client-bridge` |

¹ 降级到 `createDirectClient` 时动态 import。

### 各 Package 设计

#### `@casfa/client-bridge`

**exports**:
- `"."` → `AppClient`, `AppClientConfig`, `createAppClient`

内部模块（不导出）：`_proxy.ts`、`_rpc.ts`、`sw-client.ts`、`direct-client.ts`。

```typescript
// ── _proxy.ts ── (内部模块)
// Proxy-based 动态分发 — 无需手写每个方法

const CLIENT_NAMESPACES = new Set(["oauth", "tokens", "delegates", "depots", "fs", "nodes"]);

export function createClientProxy(rpc: RPCFn): CasfaClient {
  return new Proxy({} as CasfaClient, {
    get(_, prop: string) {
      if (CLIENT_NAMESPACES.has(prop)) {
        return new Proxy({}, {
          get(_, method: string) {
            return (...args: unknown[]) =>
              rpc({ type: "rpc", target: prop, method, args });
          },
        });
      }
      // top-level: getState, getServerInfo, setRootDelegate, getAccessToken, logout
      return (...args: unknown[]) =>
        rpc({ type: "rpc", target: "client", method: prop, args });
    },
  });
}
```

```typescript
// ── sw-client.ts ──
// SW 模式：CasfaClient API 通过 RPC 路由到 SW
// 返回 AppClient，bridge 不暴露给调用方。

export async function createSWClient(config: AppClientConfig): Promise<AppClient> {
  const swUrl = config.swUrl ?? "/sw.js";
  const reg = await navigator.serviceWorker.register(swUrl, { type: "module" });
  await navigator.serviceWorker.ready;

  const ch = new MessageChannel();
  const port = ch.port1;
  port.start();

  // 先注册 connect-ack 监听，再发送 connect，避免与 createRPC listener 竞争
  const ackPromise = new Promise<ConnectAckMessage>((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "connect-ack") {
        port.removeEventListener("message", handler);
        resolve(e.data);
      }
    };
    port.addEventListener("message", handler);
  });

  reg.active!.postMessage({ type: "connect", port: ch.port2 }, [ch.port2]);
  const ack = await ackPromise;

  // connect-ack 已收到，此后所有 port 消息走 RPC 分发
  const rpc = createRPC(port, config.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS);

  const bc = new BroadcastChannel("casfa");
  const listeners = {
    syncState:  new Set<(s: SyncState) => void>(),
    conflict:   new Set<(e: ConflictEvent) => void>(),
    syncError:  new Set<(e: SyncErrorEvent) => void>(),
    commit:     new Set<(e: SyncCommitEvent) => void>(),
  };

  bc.onmessage = (e) => {
    const msg = e.data as BroadcastMessage;
    switch (msg.type) {
      case "sync-state":    listeners.syncState.forEach((fn) => fn(msg.payload)); break;
      case "conflict":      listeners.conflict.forEach((fn) => fn(msg.payload)); break;
      case "sync-error":    listeners.syncError.forEach((fn) => fn(msg.payload)); break;
      case "commit":        listeners.commit.forEach((fn) => fn(msg.payload)); break;
      case "auth-required": /* app-level redirect */ break;
    }
  };

  // CasfaClient proxy — 直接展开到返回对象上，调用方无需 getClient()
  const proxy = createClientProxy(rpc);

  return {
    // ── CasfaClient API（RPC 透传）──
    ...proxy,

    // ── 鉴权 ──
    setUserToken: (token) =>
      rpc({ type: "set-user-token", token }),

    // ── Sync ──
    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      port.postMessage({ type: "schedule-commit", depotId, targetRoot: newRoot, lastKnownServerRoot });
    },

    getPendingRoot: (depotId) =>
      rpc({ type: "get-pending-root", depotId }) as Promise<string | null>,

    flushNow: () =>
      rpc({ type: "flush-now" }) as Promise<void>,

    // ── 事件 ──
    onSyncStateChange(fn) { listeners.syncState.add(fn); return () => listeners.syncState.delete(fn); },
    onConflict(fn)        { listeners.conflict.add(fn);   return () => listeners.conflict.delete(fn); },
    onSyncError(fn)       { listeners.syncError.add(fn);  return () => listeners.syncError.delete(fn); },
    onCommit(fn)          { listeners.commit.add(fn);     return () => listeners.commit.delete(fn); },

    // ── 生命周期 ──
    logout: () =>
      rpc({ type: "logout" }) as Promise<void>,

    dispose() {
      port.close();
      bc.close();
    },
  };
}
```

```typescript
// ── direct-client.ts ──
// 降级模式：主线程直接运行，无 SW。AppClient 接口相同，行为一致。
// CasfaClient + SyncManager 直接运行在主线程。

export async function createDirectClient(config: AppClientConfig): Promise<AppClient> {
  const { createClient } = await import("@casfa/client");
  const { createSyncManager } = await import("@casfa/explorer");

  let client: CasfaClient | null = null;
  let syncManager: SyncManager | null = null;

  const syncListeners = {
    syncState:  new Set<(s: SyncState) => void>(),
    conflict:   new Set<(e: ConflictEvent) => void>(),
    syncError:  new Set<(e: SyncErrorEvent) => void>(),
    commit:     new Set<(e: SyncCommitEvent) => void>(),
  };

  // CasfaClient 方法的懒代理：setUserToken 后才有 client 实例
  const clientProxy = new Proxy({} as CasfaClient, {
    get(_, prop: string) {
      if (!client) throw new Error("Call setUserToken first");
      return (client as any)[prop];
    },
  });

  return {
    // ── CasfaClient API（直连委托）──
    ...clientProxy,

    async setUserToken(token) {
      client = await createClient({
        baseUrl: config.baseUrl,
        realm: config.realm,
        tokenStorage: createLocalStorageProvider(),
        onAuthRequired: () => { /* app-level redirect */ },
      });
      // set user token → JWT 鉴权
      syncManager = createSyncManager({
        storage: /* FlushableStorage */,
        client,
        queueStore: /* SyncQueueStore */,
        debounceMs: config.syncDebounceMs ?? 2_000,
        onSyncStateChange: (state) => syncListeners.syncState.forEach((fn) => fn(state)),
        onConflict:        (event) => syncListeners.conflict.forEach((fn) => fn(event)),
        onSyncError:       (event) => syncListeners.syncError.forEach((fn) => fn(event)),
        onCommit:          (event) => syncListeners.commit.forEach((fn) => fn(event)),
      });
    },

    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      if (!syncManager) throw new Error("Call setUserToken first");
      syncManager.enqueue(depotId, newRoot, lastKnownServerRoot);
    },

    async getPendingRoot(depotId) {
      if (!syncManager) return null;
      return syncManager.getPendingRoot(depotId);
    },

    async flushNow() {
      if (!syncManager) return;
      await syncManager.flushNow();
    },

    onSyncStateChange(fn) { syncListeners.syncState.add(fn); return () => syncListeners.syncState.delete(fn); },
    onConflict(fn)        { syncListeners.conflict.add(fn);   return () => syncListeners.conflict.delete(fn); },
    onSyncError(fn)       { syncListeners.syncError.add(fn);  return () => syncListeners.syncError.delete(fn); },
    onCommit(fn)          { syncListeners.commit.add(fn);     return () => syncListeners.commit.delete(fn); },

    async logout() {
      if (syncManager) await syncManager.flushNow();
      client?.logout();
      syncManager = null;
      client = null;
    },

    dispose() {
      syncManager = null;
      client = null;
      syncListeners.syncState.clear();
      syncListeners.conflict.clear();
      syncListeners.syncError.clear();
      syncListeners.commit.clear();
    },
  };
}
```

#### `@casfa/client-sw`

SW 端：消息分发。client 由调用方（SW entry）持有，通过 getter/setter 传入。

```typescript
// ── message-handler.ts ──

export type MessageHandlerDeps = {
  getClient: () => CasfaClient;
  setClient: (client: CasfaClient) => void;
  syncCoordinator: SyncCoordinator;
  broadcast: (msg: BroadcastMessage) => void;
};

export function createMessageHandler(deps: MessageHandlerDeps) {
  const { getClient, setClient, syncCoordinator, broadcast } = deps;

  return async function handleMessage(msg: MainToSWMessage, port: MessagePort): Promise<void> {
    switch (msg.type) {
      case "set-user-token": {
        const client = await createClient({
          baseUrl: /* from config or msg */,
          realm: /* from config or msg */,
          tokenStorage: createIndexedDBTokenStorage("root"),
          onAuthRequired: () => broadcast({ type: "auth-required" }),
        });
        // set user token → JWT 鉴权
        setClient(client);
        syncCoordinator.setClient(client);
        port.postMessage({ type: "rpc-response", id: msg.id, result: null });
        break;
      }

      case "rpc": {
        try {
          const client = getClient();

          // ── 白名单校验 ──
          const ALLOWED_TOP_LEVEL = new Set(["getState", "getServerInfo", "getAccessToken"]);
          const ALLOWED_NAMESPACES = new Set(["oauth", "tokens", "delegates", "depots", "fs", "nodes"]);

          if (msg.target === "client") {
            if (!ALLOWED_TOP_LEVEL.has(msg.method)) {
              throw new Error(`Blocked RPC method: client.${msg.method}`);
            }
          } else if (!ALLOWED_NAMESPACES.has(msg.target)) {
            throw new Error(`Blocked RPC namespace: ${msg.target}`);
          }

          const target = msg.target === "client" ? client : (client as any)[msg.target];
          const fn = msg.target === "client" ? (client as any)[msg.method] : target[msg.method];
          if (typeof fn !== "function") throw new Error(`Not a function: ${msg.target}.${msg.method}`);
          const result = await fn.apply(target, msg.args);

          const transferables: Transferable[] = [];
          if (result?.data instanceof Uint8Array) transferables.push(result.data.buffer);
          port.postMessage({ type: "rpc-response", id: msg.id, result }, transferables);
        } catch (err) {
          port.postMessage({
            type: "rpc-response", id: msg.id,
            error: { code: "rpc_error", message: (err as Error).message },
          });
        }
        break;
      }

      case "schedule-commit": {
        syncCoordinator.enqueue(msg.depotId, msg.targetRoot, msg.lastKnownServerRoot);
        break;
      }

      case "get-pending-root":
        port.postMessage({
          type: "rpc-response", id: msg.id,
          result: syncCoordinator.getPendingRoot(msg.depotId),
        });
        break;

      case "flush-now":
        await syncCoordinator.flushNow();
        port.postMessage({ type: "rpc-response", id: msg.id, result: null });
        break;

      case "logout":
        await syncCoordinator.flushNow();
        getClient().logout();
        port.postMessage({ type: "rpc-response", id: msg.id, result: null });
        break;
    }
  };
}
```

```typescript
// ── token-storage-idb.ts ──
// DB: "casfa-auth", store: "tokens", key: "root"
// 连接池化：整个 SW 生命周期复用同一 IDBDatabase 实例。

let dbCache: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (dbCache) return dbCache;
  dbCache = await openDB("casfa-auth", 1, "tokens");
  // 浏览器可能主动关闭闲置连接
  dbCache.onclose = () => { dbCache = null; };
  return dbCache;
}

export function createIndexedDBTokenStorage(key: string): TokenStorageProvider {
  return {
    async load() {
      const db = await getDB();
      return (await get(db, "tokens", key))?.state ?? null;
    },
    async save(state) {
      const db = await getDB();
      await put(db, "tokens", { id: key, state });
    },
    async clear() {
      const db = await getDB();
      await del(db, "tokens", key);
    },
  };
}
```

#### `@casfa/explorer` — SyncCoordinator

SyncCoordinator = SyncManager 的 SW 变体：单 client 驱动 sync。

```typescript
export type SyncCoordinator = {
  /** 入队 depot commit。 */
  enqueue(depotId: string, targetRoot: string, lastKnownServerRoot: string | null): void;

  /** flush 所有 pending sync。 */
  flushNow(): Promise<void>;

  /** Background Sync 入口。 */
  runSync(): Promise<void>;

  /** 设置用于 sync 的 client。首次 setUserToken 和 recover 后调用。 */
  setClient(client: CasfaClient): void;

  /** SW activate 时恢复。从 IndexedDB 恢复 depot-queue。需先 setClient。 */
  recover(): Promise<void>;

  getPendingRoot(depotId: string): string | null;
  getState(): SyncState;
  getPendingCount(): number;
};

export type SyncCoordinatorConfig = {
  storage: FlushableStorage;
  queueStore: SyncQueueStore;
  broadcast: (msg: BroadcastMessage) => void;
  debounceMs?: number;           // default 2_000
};
```

#### SW Entry — 薄壳

```typescript
// apps/server/frontend/src/sw/sw.ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { createMessageHandler } from "@casfa/client-sw";
import { createSyncCoordinator } from "@casfa/explorer";
import { createClient } from "@casfa/client";
import type { BroadcastMessage } from "@casfa/client-bridge";

const BASE_URL = self.location.origin;

function broadcast(msg: BroadcastMessage): void {
  const bc = new BroadcastChannel("casfa");
  bc.postMessage(msg);
  bc.close();
}

// ── 单 client，SW entry 直接持有 ──
let client: CasfaClient | null = null;

const syncCoordinator = createSyncCoordinator({
  storage: /* CAS storage */,
  queueStore: /* IndexedDB-backed */,
  broadcast,
});

const handleMessage = createMessageHandler({
  getClient: () => { if (!client) throw new Error("Not authenticated"); return client; },
  setClient: (c) => { client = c; },
  syncCoordinator,
  broadcast,
});

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
  e.waitUntil(
    recoverClient().then((c) => {
      if (c) {
        client = c;
        syncCoordinator.setClient(c);
        syncCoordinator.recover();
      }
    })
  );
});

/** 从 IndexedDB 恢复 token → 重建 client。失败返回 null。 */
async function recoverClient(): Promise<CasfaClient | null> {
  const tokenStorage = createIndexedDBTokenStorage("root");
  const state = await tokenStorage.load();
  if (!state?.user) return null;
  return createClient({
    baseUrl: BASE_URL,
    realm: state.rootDelegate?.realm ?? "",
    tokenStorage,
    onAuthRequired: () => broadcast({ type: "auth-required" }),
  });
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "connect" && event.data.port instanceof MessagePort) {
    const port = event.data.port as MessagePort;

    // 回复初始状态
    port.postMessage({
      type: "connect-ack",
      syncState: syncCoordinator.getState(),
      pendingCount: syncCoordinator.getPendingCount(),
      authenticated: client !== null,
    } satisfies ConnectAckMessage);

    port.onmessage = (e) => handleMessage(e.data, port);
    port.start();
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "casfa-sync") {
    event.waitUntil(syncCoordinator.runSync());
  }
});
```

### Vite 构建

```typescript
// vite.config.ts — SW 独立 entry
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sw: resolve(__dirname, "src/sw/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
```

```jsonc
// tsconfig.sw.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ESNext", "WebWorker"], "types": [] },
  "include": ["src/sw/**/*.ts"]
}
```

## 其它

### IndexedDB 汇总

| 数据库 | Store | 访问者 | 说明 |
|--------|-------|--------|------|
| `casfa-auth` | `tokens` | SW only | JWT token 持久化，key = "root" |
| `casfa-cas-cache` (v2) | `blocks` | 主线程 W/R + SW R | CAS 节点缓存 |
| `casfa-cas-cache` (v2) | `pending-sync` | 主线程 W + SW R/D | pending keys |
| `casfa-sync` (v1) | `depot-queue` | SW R/W/D | depot commit 队列 |

### Token 管理

除初始 Cognito 登录外，所有 token 管理在 SW 内完成：

```
Cognito (主线程) → exchangeCode → JWT
  → setUserToken (RPC) → SW
  → SW 创建 CasfaClient（JWT 鉴权）
  → 自治 refresh JWT
  → 全部失败 → broadcast auth-required
```

JWT 直接作为 Bearer token 访问 realm API，不再需要 root delegate 的 AT/RT。

### SW 生命周期

SW 空闲后被浏览器终止：

- CasfaClient 的 proactive refresh（`setTimeout`）丢失 → 不影响正确性，重新激活时 `ensureAccessToken()` lazy check 会同步刷新
- `recover()` 从 IndexedDB 恢复 JWT token 并重建 client，同时恢复 SyncCoordinator 的 depot-queue

### Port 断开

Tab 关闭后 MessagePort 变为不可用。SW 无法主动感知 port 断开（`MessagePort` 没有 close 事件）。

单 client 模型下 port 断开无需清理资源——client 和 sync 状态是全局共享的。orphan port 只占微量内存，浏览器 GC 在 Tab 关闭后自动回收 `MessagePort`。

如需主动追踪连接数（如 debug 信息），可在 `beforeunload` 时发 `disconnect` 消息。

### 迁移

1. **Phase 1** — 新建 `@casfa/client-bridge`，实现 `DirectBridge`，重构调用方。无 SW，行为不变。
2. **Phase 2** — 新建 `@casfa/client-sw`（MessageHandler + IndexedDB TokenStorage），实现 `SWBridge` + proxy + SW entry。
3. **Phase 3** — `SyncCoordinator` 迁入 SW，Background Sync 集成。
4. **Phase 4** — Periodic sync、进度上报、网络状态感知。
