# Service Worker Client 设计评审（第二轮）

针对 [service-worker-sync.md](service-worker-sync.md) 单 Client + JWT 鉴权版本的评审。

> 第一轮解决的 `createRPC` 类型签名问题（✅）不再重复列出。
> delegate 栈相关条目已不适用，已移除。
> `ClientManager` 已移除——单 client 由 SW entry 直接持有。相关的 Critical #1（syncCoordinator 无 client）、Major #4（参数命名）、Minor #7（ports dead code）已不适用。
> `ClientBridge` 已内化——调用方只接触 `AppClient`（`CasfaClient` 的超集），bridge 是内部实现。相关的 Major #3（`getClient()` async）已不适用。

**所有条目已解决。**

---

## Major

### ~~1. `createDirectClient` 仍是不完整骨架~~

> ✅ 已补全：事件回调通过 `syncListeners` 分发，`logout()` 执行 flush + client.logout()，`dispose()` 清理所有引用和 listener，`scheduleCommit` 增加 null 检查抛错。

### ~~2. `SyncCoordinator` 的 `setClient` + `recover` 职责清晰化~~

> ✅ 已修复为 `recover()` 无参数，需先 `setClient`。

### ~~3. `getClient()` 无需 async~~

> ✅ 已不适用——`AppClient` 统一接口移除了 `getClient()`，CasfaClient 方法直接展开到 `AppClient` 上。

### ~~4. RPC method 分发无白名单~~

> ✅ 已修复：`message-handler.ts` 增加 `ALLOWED_TOP_LEVEL`（`getState`、`getServerInfo`、`getAccessToken`）和 `ALLOWED_NAMESPACES` 白名单校验，`typeof fn !== "function"` 兜底。

### ~~5. IndexedDB 每次 `openDB`~~

> ✅ 已修复：`token-storage-idb.ts` 引入模块级 `dbCache` 连接池，复用 `IDBDatabase` 实例。`onclose` 回调处理浏览器主动关闭。

---

## Minor

### ~~6. `connect-ack` listener 注册顺序~~

> ✅ 已修复：`sw-client.ts` 重构为先 `port.start()` + 注册 `connect-ack` handler → 发 `connect` → 等待 ack → 再 `createRPC`。事件流无竞争。

### ~~7. `BroadcastMessage` 属性命名不一致~~

> ✅ 已修复：统一为 `payload` 字段（`auth-required` 外）。

### ~~8. 迁移 Phase 2 描述~~ → ✅ 已修复
