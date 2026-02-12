# Service Worker Client

> 将 CasfaClient 运行在 Service Worker 中，统一 token 管理、网络 I/O 与后台同步。

## 动机

1. **Token 管理分散**：每个 Tab 各自持有 CasfaClient，各自 refresh JWT / AT，产生并发 race
2. **网络 I/O 阻塞 UI**：`flush()` 期间批量 `checkMany` + `put` + `claim` 在主线程 `fetch()`
3. **页面关闭 = 同步中断**：pending 数据在 IndexedDB，上传必须等下次打开页面
4. **多 Tab 重复请求**：每个 Tab 各自 flush / commit

`@casfa/client` 完全兼容 SW 环境（零 DOM 依赖），可以整体移入 Service Worker。

## 架构

```
┌───────────────────────────────────────────────┐
│  Main Thread (per Tab)                        │
│                                               │
│  bridge.getClient() → CasfaClient proxy       │
│  bridge.pushDelegate(params) → depth++        │
│  bridge.popDelegate()        → depth--        │
│                                               │
│  proxy 始终路由到 SW 端该 port 的栈顶 client    │
│                                               │
│  CachedStorage (IndexedDB)                    │
│    put() → cache + pendingKeys                │
│    get() → cache hit ? return : proxy.get()   │
└──────────────┬────────────────────────────────┘
               │ MessagePort (RPC, per Tab)
               │ BroadcastChannel (events, all Tabs)
┌──────────────▼────────────────────────────────┐
│  Service Worker (单实例)                       │
│                                               │
│  rootClient (共享, 1 实例)                     │
│  portStacks: Map<port, CasfaClient[]>         │
│    port₁: [root, delegateA]        ← depth 1  │
│    port₂: [root]                   ← depth 0  │
│                                               │
│  JWT → root delegate → 自治 refresh            │
│  push → delegates.create → 截获 token → 入栈   │
│  pop  → flush sync → revoke → 出栈             │
│                                               │
│  SyncCoordinator                              │
│    Layer 1: pending CAS → check/put/claim     │
│    Layer 2: depot-queue → get/commit          │
└───────────────────────────────────────────────┘
```

## Delegate 栈

delegate token 由服务端一次性返回，服务端不保留明文。不存在"拿 delegateId 去换 client"的场景。

sub-delegate 的唯一用途：**从当前身份临时收窄权限**（如只读、限定 depot scope），用完即销毁。

因此 client 是一个**栈**，而非 Map：

```
Stack (per port):
  [0] root client    ← JWT 登录后创建（共享实例）
  [1] sub-delegate A ← pushDelegate({ canUpload: false })
  [2] sub-delegate B ← pushDelegate({ delegatedDepots: ["d1"] })
       ↑ 栈顶 = 当前活跃
```

- `getClient()` 始终返回同一 proxy，SW 侧路由到该 port 的栈顶
- `pushDelegate(params)` → SW 用栈顶 client 调用 `delegates.create(params)` → 截获返回的 token → 创建新 CasfaClient → 入栈
- `popDelegate()` → 立即出栈（后续 RPC 路由到父级），client 进入 draining 阶段等待 pending sync 完成 → revoke → 销毁
- root（depth 0）不可 pop

### Delegate 生命周期

```
active (栈中)  ──pop──→  draining (等 sync)  ──done──→  destroyed
  ↑ RPC 路由到这里        ↑ sync 仍用此 client         revoke + logout
```

`popDelegate()` 立即返回，不阻塞。draining 在后台完成，调用方无需关心。

### 多 Tab

每个 Tab 通过 `MessagePort` 连接 SW，各自维护独立栈。Tab A push delegate 不影响 Tab B。

SW 内部结构：

```typescript
// rootClient 共享
let rootClient: CasfaClient | null = null;

// per-port 栈
type StackEntry = { client: CasfaClient; delegateId: string };
const portStacks = new Map<MessagePort, StackEntry[]>();

// 已 pop 但 sync 未完成的 delegate（后台 draining）
const draining = new Map<string, { client: CasfaClient; delegateId: string }>();

function getTopClient(port: MessagePort): CasfaClient {
  const stack = portStacks.get(port)!;
  return stack.length > 0 ? stack[stack.length - 1].client : rootClient!;
}
```

## 接口

```typescript
type ClientBridge = {
  /**
   * RPC: 推送 user JWT。SW 创建 root CasfaClient，自治 refresh。
   * 重复调用覆盖旧 token（re-login）。
   */
  setUserToken(token: StoredUserToken): Promise<void>;

  /**
   * 获取 CasfaClient proxy。
   *
   * 返回的 proxy 始终路由到 SW 端当前栈顶 client。
   * push/pop 改变栈顶后，同一 proxy 自动指向新的 client——调用方无需感知。
   *
   * 首次调用前必须先 setUserToken。
   */
  getClient(): Promise<CasfaClient>;

  // ── Delegate 栈 ──

  /** RPC: 从栈顶 client 创建子 delegate，push 新 client，返回 delegateId */
  pushDelegate(params: CreateDelegateInput): Promise<string>;

  /**
   * RPC: 立即出栈，client 进入 draining 等待 pending sync 完成后 revoke + 销毁。
   * 非阻塞——不等 sync 结束即返回。root 不可 pop，会 throw。
   */
  popDelegate(): Promise<void>;

  /** RPC: 当前栈深度（0 = root only） */
  getDepth(): Promise<number>;

  // ── Sync ──

  scheduleCommit(depotId: string, newRoot: string, lastKnownServerRoot: string | null): void;
  getPendingRoot(depotId: string): Promise<string | null>;
  flushNow(): Promise<void>;

  // ── 事件 ──

  onSyncStateChange(fn: (state: SyncState) => void): () => void;
  onConflict(fn: (event: ConflictEvent) => void): () => void;
  onSyncError(fn: (event: SyncErrorEvent) => void): () => void;
  onCommit(fn: (event: SyncCommitEvent) => void): () => void;

  logout(): Promise<void>;
  dispose(): void;
};

/** SW 模式 */
function createSWBridge(config: BridgeConfig): Promise<ClientBridge>;

/** 降级：主线程直接运行 */
function createDirectBridge(config: BridgeConfig): Promise<ClientBridge>;

/** 工厂：SW 注册失败自动降级 */
async function createBridge(config: BridgeConfig): Promise<ClientBridge> {
  if ("serviceWorker" in navigator) {
    try {
      return await createSWBridge(config);
    } catch {
      console.warn("SW registration failed, falling back to direct mode");
    }
  }
  return createDirectBridge(config);
}

type BridgeConfig = {
  baseUrl: string;
  realm: string;
  swUrl?: string | URL;            // 默认 "/sw.js"
  rpcTimeoutMs?: number;           // 默认 30_000
  syncDebounceMs?: number;         // 默认 2_000
};
```

### 使用示例

```typescript
// 初始化
const bridge = await createBridge({ baseUrl: "", realm });

// OAuth 登录后
await bridge.setUserToken(userJWT);

// 获取 client — 始终同一 proxy
const client = await bridge.getClient();
const depots = await client.depots.list();

// 临时收窄权限
const delegateId = await bridge.pushDelegate({ canUpload: false, canManageDepot: false });
// client 仍是同一 proxy，但 SW 现在路由到子 delegate
const restricted = await client.fs.ls(rootKey);   // 用的是子 delegate 权限

// 用完回退
await bridge.popDelegate();
// client 自动回到 root
```

### CasfaClient（不变）

proxy 和真实 CasfaClient 实现同一接口：

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
3. **RPC 无需 delegateId** — SW 按 port 找栈，取栈顶 client

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

/** RPC 调用：路由到栈顶 client */
type RPCRequest = {
  type: "rpc";
  id: number;
  target: "oauth" | "tokens" | "delegates" | "depots" | "fs" | "nodes" | "client";
  method: string;
  args: unknown[];
};

/** Delegate 栈操作 */
type PushDelegateMessage = {
  type: "push-delegate";
  id: number;
  params: CreateDelegateInput;
};

type PopDelegateMessage = {
  type: "pop-delegate";
  id: number;
};

type GetDepthMessage = {
  type: "get-depth";
  id: number;
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
  | PushDelegateMessage
  | PopDelegateMessage
  | GetDepthMessage
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
  | { type: "sync-state";    state: SyncState }
  | { type: "conflict";      event: ConflictEvent }
  | { type: "sync-error";    event: SyncErrorEvent }
  | { type: "commit";        event: SyncCommitEvent }
  | { type: "pending-count"; count: number }
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
 │     port: port2 }, [port2])  ──────→│  portStacks.set(port, [])
 │                                      │
 │←── port.postMessage({                │
 │     type: "connect-ack",             │
 │     syncState, pendingCount,         │
 │     authenticated })  ──────────────│
 │                                      │
 │── port.postMessage({                 │
 │     type: "set-user-token",          │
 │     id: 1, token })  ─────────────→│  IndexedDB 存储
 │                                      │  创建 root CasfaClient
 │                                      │  此后自治 refresh
 │←── { type: "rpc-response",          │
 │     id: 1, result: null }  ─────────│
```

#### 2. RPC：nodes.get（栈顶 = root）

```
Tab                                    SW
 │                                      │
 │── port.postMessage({                 │
 │     type: "rpc", id: 2,             │
 │     target: "nodes",                 │
 │     method: "get",                   │
 │     args: ["0a1b..."] })  ────────→│  client = getTopClient(port)
 │                                      │  result = await client.nodes.get(...)
 │                                      │   (AT 过期 → 自动 refresh)
 │←── port.postMessage({                │
 │     type: "rpc-response", id: 2,     │
 │     result: { ok: true,              │
 │       data: Uint8Array } },          │
 │     [data.buffer])  ← Transfer ────│
```

#### 3. Push → RPC → Pop

```
Tab                                    SW
 │                                      │
 │── { type: "push-delegate", id: 3,   │
 │     params: { canUpload: false,      │
 │     canManageDepot: false } }  ────→│  topClient = getTopClient(port)
 │                                      │  res = await topClient.delegates.create(params)
 │                                      │  newClient = createClient(截获的 token)
 │                                      │  stack.push({ client: newClient, delegateId })
 │←── { id: 3, result: delegateId }  ──│
 │                                      │
 │── { type: "rpc", id: 4,             │
 │     target: "fs", method: "ls",     │
 │     args: [rootKey] }  ───────────→│  client = getTopClient(port)  ← 现在是子 delegate
 │                                      │  result = await client.fs.ls(rootKey)
 │←── { id: 4, result: ... }  ─────────│
 │                                      │
 │── { type: "pop-delegate",           │
 │     id: 5 }  ──────────────────────→│  { client, delegateId } = stack.pop()
 │                                      │  draining.set(delegateId, { client, delegateId })
 │←── { id: 5, result: null }  ────────│  ← 立即返回
 │                                      │
 │── { type: "rpc", id: 6, ... }  ───→│  client = getTopClient(port)  ← 回到 root
 │                                      │
 │                                      │  (后台) sync 完成 →
 │                                      │    rootClient.delegates.revoke(delegateId)
 │                                      │    client.logout()
 │                                      │    draining.delete(delegateId)
```

#### 4. Sync

```
Tab                                    SW
 │                                      │
 │── port.postMessage({                 │
 │     type: "schedule-commit",         │
 │     depotId: "d_1",                  │
 │     targetRoot: "0xabc",             │
 │     lastKnownServerRoot: "0x789"     │
 │   })  ──────────────────────────→│  capturedClient = getTopClient(port)
 │                                      │  enqueue(depotId, targetRoot, capturedClient)
 │                                      │  debounce 2s
 │                                      │
 │                                      │  runSync():
 │                                      │    用 capturedClient flush CAS nodes
 │                                      │    用 capturedClient commit depot
 │                                      │
 │←── BroadcastChannel ──────────────│
 │     { type: "commit",               │
 │       event: { depotId,              │
 │                committedRoot } }     │
 │                                      │
Tab₂ ←── (也收到)  ──────────────────│
```

> `scheduleCommit` 时 SW **捕获当前栈顶 client**。即使之后 pop，已入队的 sync 仍用原 client 完成。
>
> MessagePort 保证消息 FIFO。`scheduleCommit` 后紧接 `popDelegate`，SW 端保证先 enqueue 再 pop。
>
> `popDelegate` **立即出栈返回**，client 进入 draining 集合。SyncCoordinator 在所有 pending commits 完成后自动 revoke + 销毁。

#### 5. Token Refresh 失败

```
                                       SW
                                        │
                                        │  AT refresh → 401
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
    | PushDelegateMessage
    | PopDelegateMessage
    | GetDepthMessage
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
      types.ts                     #   ClientBridge, BridgeConfig, 所有消息类型
      sw-bridge.ts                 #   createSWBridge
      direct-bridge.ts             #   createDirectBridge
      proxy.ts                     #   createClientProxy (Proxy-based)
      rpc.ts                       #   createRPC, extractTransferables
      index.ts                     #   export createBridge 工厂

  client-sw/                       # @casfa/client-sw (新建)
    src/
      client-stack.ts              #   per-port CasfaClient 栈
      message-handler.ts           #   onMessage 分发
      token-storage-idb.ts         #   IndexedDB TokenStorageProvider
      index.ts

  explorer/                        # @casfa/explorer (已有，扩展)
    src/
      core/
        sync-manager.ts            #   SyncManager (不变，降级用)
        sync-coordinator.ts        #   SyncCoordinator (新建，SW 环境用)
```

### SW 入口

```
apps/server/frontend/
  src/
    sw/
      sw.ts                        # 薄壳
    lib/
      bridge.ts                    # createBridge 工厂 + config
```

### 依赖关系

```
apps/server/frontend (主线程 bundle)
  └─ @casfa/client-bridge
       ├─ (types only) @casfa/client
       └─ (dynamic) @casfa/client       ← DirectBridge 降级时才 import

apps/server/frontend (SW bundle: sw.ts)
  ├─ @casfa/client-sw
  │    └─ @casfa/client                  ← 真实实例
  └─ @casfa/explorer (SyncCoordinator)
```

| Bundle | 包含 | 不包含 |
|--------|------|--------|
| 主线程 | `@casfa/client-bridge` (proxy) | `@casfa/client`¹, `@casfa/client-sw` |
| SW | `@casfa/client`, `@casfa/client-sw`, `SyncCoordinator` | `@casfa/client-bridge` |

¹ 降级到 `DirectBridge` 时动态 import。

### 各 Package 设计

#### `@casfa/client-bridge`

**exports**:
- `"."` → types + createBridge 工厂
- `"./sw"` → sw-bridge.ts + proxy.ts + rpc.ts
- `"./direct"` → direct-bridge.ts

```typescript
// ── proxy.ts ──
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
// ── sw-bridge.ts ──

export async function createSWBridge(config: BridgeConfig): Promise<ClientBridge> {
  const swUrl = config.swUrl ?? "/sw.js";
  const reg = await navigator.serviceWorker.register(swUrl, { type: "module" });
  await navigator.serviceWorker.ready;

  const ch = new MessageChannel();
  const port = ch.port1;
  const rpc = createRPC(port, config.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS);
  port.start();

  reg.active!.postMessage({ type: "connect", port: ch.port2 }, [ch.port2]);

  // 等待 connect-ack
  const ack = await new Promise<ConnectAckMessage>((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "connect-ack") {
        port.removeEventListener("message", handler);
        resolve(e.data);
      }
    };
    port.addEventListener("message", handler);
  });

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
      case "sync-state":    listeners.syncState.forEach((fn) => fn(msg.state)); break;
      case "conflict":      listeners.conflict.forEach((fn) => fn(msg.event)); break;
      case "sync-error":    listeners.syncError.forEach((fn) => fn(msg.event)); break;
      case "commit":        listeners.commit.forEach((fn) => fn(msg.event)); break;
      case "auth-required": /* app-level redirect */ break;
    }
  };

  let proxy: CasfaClient | null = null;

  return {
    setUserToken: (token) =>
      rpc({ type: "set-user-token", token }),

    async getClient() {
      if (!proxy) proxy = createClientProxy(rpc);
      return proxy;
    },

    pushDelegate: (params) =>
      rpc({ type: "push-delegate", params }) as Promise<string>,

    popDelegate: () =>
      rpc({ type: "pop-delegate" }) as Promise<void>,

    getDepth: () =>
      rpc({ type: "get-depth" }) as Promise<number>,

    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      port.postMessage({ type: "schedule-commit", depotId, targetRoot: newRoot, lastKnownServerRoot });
    },

    getPendingRoot: (depotId) =>
      rpc({ type: "get-pending-root", depotId }) as Promise<string | null>,

    flushNow: () =>
      rpc({ type: "flush-now" }) as Promise<void>,

    onSyncStateChange(fn) { listeners.syncState.add(fn); return () => listeners.syncState.delete(fn); },
    onConflict(fn)        { listeners.conflict.add(fn);   return () => listeners.conflict.delete(fn); },
    onSyncError(fn)       { listeners.syncError.add(fn);  return () => listeners.syncError.delete(fn); },
    onCommit(fn)          { listeners.commit.add(fn);     return () => listeners.commit.delete(fn); },

    logout: () =>
      rpc({ type: "logout" }) as Promise<void>,

    dispose() {
      port.close();
      bc.close();
      proxy = null;
    },
  };
}
```

```typescript
// ── direct-bridge.ts ──
// 降级模式：主线程直接运行，无 SW。接口相同，行为一致。

export async function createDirectBridge(bridgeConfig: BridgeConfig): Promise<ClientBridge> {
  const { createClient } = await import("@casfa/client");
  const { createSyncManager } = await import("@casfa/explorer");

  type StackEntry = { client: CasfaClient; delegateId: string };
  const stack: StackEntry[] = [];
  let rootClient: CasfaClient | null = null;
  let syncManager: SyncManager | null = null;

  function getTop(): CasfaClient {
    return stack.length > 0 ? stack[stack.length - 1].client : rootClient!;
  }

  // proxy delegates to getTop() — stack changes are transparent
  const proxy: CasfaClient = new Proxy({} as CasfaClient, {
    get(_, prop: string) {
      const target = getTop();
      if (CLIENT_NAMESPACES.has(prop)) return (target as any)[prop];
      return (target as any)[prop];
    },
  });

  return {
    async setUserToken(token) {
      rootClient = await createClient({
        baseUrl: bridgeConfig.baseUrl,
        realm: bridgeConfig.realm,
        tokenStorage: createLocalStorageProvider(),
        onAuthRequired: () => { /* app-level redirect */ },
      });
      // TODO: set user token on rootClient
    },

    async getClient() {
      return proxy;
    },

    async pushDelegate(params) {
      const top = getTop();
      const result = await top.delegates.create(params);
      if (!result.ok) throw new Error(result.error.message);
      const { delegateId, refreshToken, accessToken } = result.data;

      const client = await createClient({
        baseUrl: bridgeConfig.baseUrl,
        realm: bridgeConfig.realm,
        tokenStorage: createLocalStorageProvider(`casfa_tokens_${delegateId}`),
      });
      client.setRootDelegate({
        delegateId, realm: bridgeConfig.realm,
        refreshToken, accessToken,
        accessTokenExpiresAt: /* from response */,
        depth: stack.length + 1,
        canUpload: params.canUpload,
        canManageDepot: params.canManageDepot,
      });
      stack.push({ client, delegateId });
      return delegateId;
    },

    async popDelegate() {
      if (stack.length === 0) throw new Error("Cannot pop root client");
      const { client, delegateId } = stack.pop()!;
      await syncManager?.flushNow();
      await rootClient!.delegates.revoke(delegateId);
      client.logout();
    },

    async getDepth() {
      return stack.length;
    },

    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      syncManager?.enqueue(depotId, newRoot, lastKnownServerRoot);
    },

    async getPendingRoot(depotId) {
      return syncManager?.getPendingRoot(depotId) ?? null;
    },

    async flushNow() {
      await syncManager?.flushNow();
    },

    // events → direct listeners on syncManager
    // logout → flush + clear all
    // dispose → noop
  };
}
```

#### `@casfa/client-sw`

SW 端：per-port 栈管理、消息分发。

```typescript
// ── client-stack.ts ──

export type StackEntry = {
  client: CasfaClient;
  delegateId: string;
};

export type ClientStackManager = {
  /** 初始化 root client（所有 port 共享） */
  initRoot(userToken: StoredUserToken): Promise<void>;

  /** 注册新 port，初始化空栈 */
  registerPort(port: MessagePort): void;

  /** 注销 port，清理该 port 的全部子 delegate */
  unregisterPort(port: MessagePort): Promise<void>;

  /** 获取指定 port 的栈顶 client */
  getTopClient(port: MessagePort): CasfaClient;

  /** push: 从栈顶 client 创建子 delegate → 入栈 */
  push(port: MessagePort, params: CreateDelegateInput): Promise<string>;

  /** pop: 出栈并返回 entry（不 revoke，由调用方通过 drainDelegate 处理）。root 不可 pop。 */
  pop(port: MessagePort): StackEntry;

  /** 获取指定 port 的栈顶 delegateId（null = root） */
  getTopDelegateId(port: MessagePort): string | null;

  /** 获取指定 port 的栈深度 */
  getDepth(port: MessagePort): number;

  /** 全局登出 */
  logout(): Promise<void>;

  /** SW 重启恢复 root client */
  recover(): Promise<void>;

  /** root client 是否已初始化 */
  isAuthenticated(): boolean;

  /** 获取 root client（recover 后传给 SyncCoordinator） */
  getRootClient(): CasfaClient | null;
};

export function createClientStackManager(callbacks: {
  onAuthRequired: () => void;
  baseUrl: string;
  realm: string;
}): ClientStackManager {
  let rootClient: CasfaClient | null = null;
  const portStacks = new Map<MessagePort, StackEntry[]>();

  return {
    async initRoot(userToken) {
      rootClient = await createClient({
        baseUrl: callbacks.baseUrl,
        realm: callbacks.realm,
        tokenStorage: createIndexedDBTokenStorage("root"),
        onAuthRequired: callbacks.onAuthRequired,
      });
      // set user token → trigger root delegate creation
    },

    registerPort(port) {
      portStacks.set(port, []);
    },

    async unregisterPort(port) {
      const stack = portStacks.get(port);
      if (stack) {
        // pop all sub-delegates for this port
        while (stack.length > 0) {
          const { client, delegateId } = stack.pop()!;
          await rootClient?.delegates.revoke(delegateId);
          client.logout();
        }
      }
      portStacks.delete(port);
    },

    getTopClient(port) {
      const stack = portStacks.get(port)!;
      return stack.length > 0 ? stack[stack.length - 1].client : rootClient!;
    },

    async push(port, params) {
      const top = this.getTopClient(port);
      const result = await top.delegates.create(params);
      if (!result.ok) throw new Error(result.error.message);

      const { delegateId, refreshToken, accessToken } = result.data;
      const client = await createClient({
        baseUrl: callbacks.baseUrl,
        realm: callbacks.realm,
        tokenStorage: createIndexedDBTokenStorage(delegateId),
        onAuthRequired: callbacks.onAuthRequired,
      });
      // delegates.create 返回 token 明文 → 直接注入
      client.setRootDelegate({
        delegateId, realm: callbacks.realm,
        refreshToken, accessToken,
        accessTokenExpiresAt: result.data.atExpiresAt,
        depth: (portStacks.get(port)?.length ?? 0) + 1,
        canUpload: params.canUpload,
        canManageDepot: params.canManageDepot,
      });

      portStacks.get(port)!.push({ client, delegateId });
      return delegateId;
    },

    async pop(port) {
      const stack = portStacks.get(port)!;
      if (stack.length === 0) throw new Error("Cannot pop root client");
      return stack.pop()!;  // 返回 entry，不 revoke——caller 负责 drain
    },

    getTopDelegateId(port) {
      const stack = portStacks.get(port)!;
      return stack.length > 0 ? stack[stack.length - 1].delegateId : null;
    },

    getDepth(port) {
      return portStacks.get(port)?.length ?? 0;
    },

    async logout() {
      // pop all stacks for all ports
      for (const [port, stack] of portStacks) {
        while (stack.length > 0) {
          const { client, delegateId } = stack.pop()!;
          await rootClient?.delegates.revoke(delegateId);
          client.logout();
        }
      }
      rootClient?.logout();
      rootClient = null;
    },

    async recover() {
      // 从 IndexedDB 加载 root token
      // 若有效 → 重建 rootClient
    },

    isAuthenticated() {
      return rootClient !== null;
    },

    getRootClient() {
      return rootClient;
    },
  };
}
```

```typescript
// ── message-handler.ts ──

export function createMessageHandler(deps: {
  stackManager: ClientStackManager;
  syncCoordinator: SyncCoordinator;
  broadcast: (msg: BroadcastMessage) => void;
}) {
  const { stackManager, syncCoordinator, broadcast } = deps;

  return async function handleMessage(msg: MainToSWMessage, port: MessagePort): Promise<void> {
    switch (msg.type) {
      case "set-user-token": {
        await stackManager.initRoot(msg.token);
        port.postMessage({ type: "rpc-response", id: msg.id, result: null });
        break;
      }

      case "rpc": {
        try {
          const client = stackManager.getTopClient(port);
          const target = msg.target === "client" ? client : (client as any)[msg.target];
          const fn = msg.target === "client" ? (client as any)[msg.method] : target[msg.method];
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

      case "push-delegate": {
        try {
          const delegateId = await stackManager.push(port, msg.params);
          port.postMessage({ type: "rpc-response", id: msg.id, result: delegateId });
        } catch (err) {
          port.postMessage({
            type: "rpc-response", id: msg.id,
            error: { code: "push_error", message: (err as Error).message },
          });
        }
        break;
      }

      case "pop-delegate": {
        try {
          // 取出栈顶 entry
          const { client, delegateId } = stackManager.pop(port);
          // 注册 draining：sync 完成后自动 revoke + 销毁
          syncCoordinator.drainDelegate(delegateId, async () => {
            await rootClient.delegates.revoke(delegateId);
            client.logout();
          });
          // 立即返回，不等 sync
          port.postMessage({ type: "rpc-response", id: msg.id, result: null });
        } catch (err) {
          port.postMessage({
            type: "rpc-response", id: msg.id,
            error: { code: "pop_error", message: (err as Error).message },
          });
        }
        break;
      }

      case "get-depth":
        port.postMessage({
          type: "rpc-response", id: msg.id,
          result: stackManager.getDepth(port),
        });
        break;

      case "schedule-commit": {
        const client = stackManager.getTopClient(port);
        const delegateId = stackManager.getTopDelegateId(port);
        syncCoordinator.enqueue(msg.depotId, msg.targetRoot, msg.lastKnownServerRoot, client, delegateId);
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
        await stackManager.logout();
        port.postMessage({ type: "rpc-response", id: msg.id, result: null });
        break;
    }
  };
}
```

```typescript
// ── token-storage-idb.ts ──
// DB: "casfa-auth", store: "tokens", key: delegateId | "root"

export function createIndexedDBTokenStorage(key: string): TokenStorageProvider {
  return {
    async load() {
      const db = await openDB("casfa-auth", 1, "tokens");
      return (await get(db, "tokens", key))?.state ?? null;
    },
    async save(state) {
      const db = await openDB("casfa-auth", 1, "tokens");
      await put(db, "tokens", { id: key, state });
    },
    async clear() {
      const db = await openDB("casfa-auth", 1, "tokens");
      await del(db, "tokens", key);
    },
  };
}
```

#### `@casfa/explorer` — SyncCoordinator

SyncCoordinator = SyncManager 的 SW 变体：接受 per-client 的 enqueue，支持 `flushClient()` 按 client 纬度 flush。

```typescript
export type SyncCoordinator = {
  /** 入队 depot commit。捕获当时的 client 引用和 delegateId，后续 sync 用它执行。 */
  enqueue(depotId: string, targetRoot: string, lastKnownServerRoot: string | null, client: CasfaClient, delegateId: string | null): void;

  /**
   * 注册 draining delegate。pop 后调用，SyncCoordinator 在该 delegate 的
   * 所有 pending commits 完成后自动执行 onDrained 回调（revoke + 销毁）。
   * 如果没有 pending commits，立即执行 onDrained。
   */
  drainDelegate(delegateId: string, onDrained: () => Promise<void>): void;

  /** flush 所有 pending sync。 */
  flushNow(): Promise<void>;

  /** Background Sync 入口。 */
  runSync(): Promise<void>;

  /**
   * SW activate 时恢复。
   * 持久化的 sync entry 不保存 client 引用，恢复后一律用 rootClient
   * 执行（安全，因为 root 权限 ⊇ 任何子 delegate）。
   */
  recover(rootClient: CasfaClient): Promise<void>;

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

type SyncQueueEntry = DepotSyncEntry & {
  client: CasfaClient;          // 入队时捕获的 client 引用
  delegateId: string | null;    // null = root。用于匹配 drainDelegate。
};
```

#### SW Entry — 薄壳

```typescript
// apps/server/frontend/src/sw/sw.ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { createClientStackManager, createMessageHandler } from "@casfa/client-sw";
import { createSyncCoordinator } from "@casfa/explorer";
import type { BroadcastMessage } from "@casfa/client-bridge";

const BASE_URL = self.location.origin;
const REALM = "default";  // or from config

function broadcast(msg: BroadcastMessage): void {
  const bc = new BroadcastChannel("casfa");
  bc.postMessage(msg);
  bc.close();
}

const stackManager = createClientStackManager({
  onAuthRequired: () => broadcast({ type: "auth-required" }),
  baseUrl: BASE_URL,
  realm: REALM,
});

const syncCoordinator = createSyncCoordinator({
  storage: /* CAS storage */,
  queueStore: /* IndexedDB-backed */,
  broadcast,
});

const handleMessage = createMessageHandler({
  stackManager,
  syncCoordinator,
  broadcast,
});

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
  e.waitUntil(stackManager.recover());
  e.waitUntil(syncCoordinator.recover(stackManager.getRootClient()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "connect" && event.data.port instanceof MessagePort) {
    const port = event.data.port as MessagePort;
    stackManager.registerPort(port);

    // 回复初始状态
    port.postMessage({
      type: "connect-ack",
      syncState: syncCoordinator.getState(),
      pendingCount: syncCoordinator.getPendingCount(),
      authenticated: stackManager.isAuthenticated(),
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
| `casfa-auth` | `tokens` | SW only | token 持久化，key = "root" / delegateId |
| `casfa-cas-cache` (v2) | `blocks` | 主线程 W/R + SW R | CAS 节点缓存 |
| `casfa-cas-cache` (v2) | `pending-sync` | 主线程 W + SW R/D | pending keys |
| `casfa-sync` (v1) | `depot-queue` | SW R/W/D | depot commit 队列 |

### Token 管理

除初始 Cognito 登录外，所有 token 管理在 SW 内完成：

```
Cognito (主线程) → exchangeCode → JWT
  → setUserToken (RPC) → SW
  → SW 创建 root CasfaClient
  → 自治 refresh JWT + RT → AT
  → 全部失败 → broadcast auth-required
```

sub-delegate token：`delegates.create()` 在 SW 内执行 → token 明文不出 SW → 比主线程更安全。

### SW 生命周期

SW 空闲后被浏览器终止：

- CasfaClient 的 proactive refresh（`setTimeout`）丢失 → 不影响正确性，重新激活时 `ensureAccessToken()` lazy check 会同步刷新
- per-port 栈在 SW 终止后丢失 → sub-delegate 是临时的（用于权限收窄），SW 重启时不恢复
- `recover()` 仅恢复 root client（从 IndexedDB token）和 SyncCoordinator（从 IndexedDB depot-queue）

### Port 断开

Tab 关闭后 MessagePort 变为不可用。SW 无法主动感知 port 断开（`MessagePort` 没有 close 事件）。两种处理方式：

1. **主线程 `beforeunload`**：发送 `disconnect` 消息，SW 调用 `unregisterPort(port)` 清理栈
2. **惰性清理**：RPC 发送失败（port.postMessage throw）时移除 port

推荐方案 1 + 方案 2 兜底。

### 迁移

1. **Phase 1** — 新建 `@casfa/client-bridge`，实现 `DirectBridge`，重构调用方。无 SW，行为不变。
2. **Phase 2** — 新建 `@casfa/client-sw`（ClientStackManager + MessageHandler + IndexedDB TokenStorage），实现 `SWBridge` + proxy + SW entry。
3. **Phase 3** — `SyncCoordinator` 迁入 SW，Background Sync 集成。
4. **Phase 4** — Periodic sync、进度上报、网络状态感知。
