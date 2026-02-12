# Service Worker Client 设计评审

针对 [service-worker-sync.md](service-worker-sync.md) 的评审意见。

---

## Critical

### 1. `createRPC` 类型签名与实际使用不匹配 ✅

`createRPC` 返回的函数签名约束为 `Omit<RPCRequest, "id">`，但实际被用于发送所有带 `id` 的消息：

```typescript
rpc({ type: "set-user-token", token })      // SetUserTokenMessage
rpc({ type: "push-delegate", params })       // PushDelegateMessage
rpc({ type: "pop-delegate" })                // PopDelegateMessage
rpc({ type: "get-depth" })                   // GetDepthMessage
rpc({ type: "flush-now" })                   // FlushNowMessage
rpc({ type: "logout" })                      // LogoutMessage
rpc({ type: "get-pending-root", depotId })   // GetPendingRootMessage
```

这些消息结构各不相同。`rpc` 内部访问 `msg.args`（`extractTransferables(msg.args ?? [])`）和 `msg.target` / `msg.method`（超时错误），但非 `RPCRequest` 消息没有这些字段。

**建议**：输入类型改为所有带 `id` 消息的 union，`extractTransferables` 只对含 `args` 的消息执行。

> **决议**：同意。修复 `createRPC` 的输入类型为 `RPCMessage` union。

### 2. `SyncQueueEntry.client` 引用无法持久化 ✅

`SyncQueueEntry = DepotSyncEntry & { client: CasfaClient }`，client 引用只在内存。

- `SyncCoordinator.recover()` 从 IndexedDB 恢复 depot-queue 时，`client` 引用已丢失
- `SyncQueueStore.loadAll()` 返回 `DepotSyncEntry[]`，不含 client

recover 后用什么 client 执行 sync？文档未说明。

**建议**：

- `recover()` 显式用 root client 执行所有恢复的 entries
- 补充说明：持久化的 sync entry 不保存 client 引用，恢复后一律用 root client（安全，因为 root 权限 ⊇ 子 delegate）

> **决议**：同意。recover 后一律用 root client。

### 3. `scheduleCommit` fire-and-forget 与 `popDelegate` 的协调 ✅

`scheduleCommit` 无 `id`，不走 RPC。紧接着调用 `await popDelegate()`（RPC）时，需要保证 SW 先处理 `schedule-commit` 再处理 `pop-delegate`。

这依赖 MessagePort 的 FIFO 保证，但文档未说明。

**建议**：在 Sync 序列图注释中补充："MessagePort 保证消息 FIFO。`scheduleCommit` 后紧接 `popDelegate`，SW 端保证先 enqueue 再 flush+pop。"

> **决议**：采用不同方案。`popDelegate()` 不阻塞等 sync 完成，delegate 进入 draining 阶段：
>
> 1. **立即从栈中移除**（后续 RPC 路由到父级）
> 2. **client 移入 draining 集合**（SyncCoordinator 继续用它完成 pending commits）
> 3. **所有 commit 完成后** → revoke delegate → 销毁 client
>
> delegate 生命周期：`active (栈中)` → `draining (已 pop，等 sync)` → `destroyed`。
> `popDelegate()` 变为非阻塞，调用方体感更快。

---

## Major

### 4. DirectBridge proxy 缓存 namespace 后 push/pop 不生效

```typescript
// DirectBridge 的 proxy
get(_, prop: string) {
  const target = getTop();
  if (CLIENT_NAMESPACES.has(prop)) return (target as any)[prop];
  return (target as any)[prop];  // 两个分支完全一样
}
```

如果调用方缓存了 namespace 引用：

```typescript
const client = await bridge.getClient();
const fs = client.fs;  // 缓存了 root 的 fs 对象
await bridge.pushDelegate({ ... });
fs.ls(root);  // 仍然用 root 的 fs，push 没有生效！
```

SWBridge 没这个问题——每次 `fs.ls` 都会生成新的 RPC 调用。

**建议**：DirectBridge 的 namespace 也应返回 Proxy，延迟到方法调用时再 resolve 栈顶：

```typescript
if (CLIENT_NAMESPACES.has(prop)) {
  return new Proxy({}, {
    get(_, method: string) {
      return (...args: unknown[]) => getTop()[prop][method](...args);
    },
  });
}
```

### 5. `getClient()` 无需 async

两个实现都是同步返回：

- SWBridge: `if (!proxy) proxy = createClientProxy(rpc); return proxy;`
- DirectBridge: `return proxy;`

上一版 review 建议 async 是因为 DirectBridge 需要 `await createClient()`。但现在 DirectBridge 也用 Proxy 延迟求值，`getClient` 本身不做异步操作。

**建议**：改回 `getClient(): CasfaClient`（同步）。调用方少写一个 `await`。

### 6. RPC method 分发无白名单

```typescript
const fn = msg.target === "client" ? (client as any)[msg.method] : target[msg.method];
const result = await fn.apply(target, msg.args);
```

`msg.method` 是任意 string。主线程可以调用 `setRootDelegate`（注入任意 delegate token）、`constructor`、`__proto__` 等。

虽然 postMessage 来源是自己的代码（可信），但防御性编程应白名单。尤其 `setRootDelegate` 不应通过 RPC 暴露——token 操作只应通过 `set-user-token` 和 `push-delegate` 消息。

**建议**：

```typescript
const ALLOWED_METHODS: Record<string, Set<string>> = {
  client:    new Set(["getState", "getServerInfo", "getAccessToken", "logout"]),
  oauth:     new Set(["getConfig", "login", "exchangeCode", "getMe"]),
  // ...
};
// setRootDelegate 不在白名单中
```

### 7. `createClientStackManager` 的 `this` 和参数命名

两个问题：

**a)** `push` 方法里用了 `this.getTopClient(port)`。但闭包工厂返回的普通对象没有可靠的 `this` 绑定。codebase 里所有其他 factory（`createClient`、`createSyncManager`、`createTokenStore`）都用闭包内直接调用，不依赖 `this`。

**b)** 参数名 `callbacks` 但混入了 `baseUrl`/`realm` 配置项。

**建议**：参数改名 `config`；`this.getTopClient(port)` 改为闭包内独立函数调用。

### 8. IndexedDB 每次操作重新 `openDB`

```typescript
async load() {
  const db = await openDB("casfa-auth", 1, "tokens");  // 每次都 open
  // ...
}
```

`load`/`save`/`clear` 每次都打开新连接。token refresh 频繁触发 `save`，重复 open/close 有性能开销。

**建议**：连接池化：

```typescript
let dbPromise: Promise<IDBDatabase> | null = null;
function getDB() {
  return (dbPromise ??= openDB("casfa-auth", 1, "tokens"));
}
```

---

## Minor

### 9. `connect-ack` listener 注册顺序

`createRPC` 的 listener（过滤 `type === "rpc-response"`）和 `connect-ack` 的临时 listener 同时挂在 port 上。虽然不会出错（type 互不匹配），但流程可以更清晰。

**建议**：把 `port.start()` 移到 `connect-ack` resolve 之后，或合并到 `createRPC` 内部统一分发。

### 10. `flushClient` 用引用相等匹配

```typescript
flushClient(client: CasfaClient): Promise<void>;
```

从 `SyncQueueEntry.client` 过滤 `===` 匹配的 entries。如果 client 引用意外丢失或替换，无法匹配。

**建议**：改为 `flushDelegate(delegateId: string)`，`SyncQueueEntry` 同时存 `delegateId` + `client`，用 `delegateId` 做匹配 key。

### 11. `BroadcastMessage` 属性命名不一致

```typescript
| { type: "sync-state";    state: SyncState }       // ← 语义字段名
| { type: "conflict";      event: ConflictEvent }   // ← 统一叫 event
| { type: "pending-count"; count: number }           // ← 语义字段名
```

**建议**：统一用语义字段名或统一用 `payload`。

### 12. SW entry realm 硬编码

```typescript
const REALM = "default";  // or from config
```

SW 脚本是独立 entry，无法接受 runtime config。但 `createClientStackManager` 创建时就需要 realm。

**建议**：realm 随 `set-user-token` 传入，`createClientStackManager` 延迟绑定到 `initRoot` 时。
