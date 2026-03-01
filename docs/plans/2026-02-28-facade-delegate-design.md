# Facade 命名与 Delegate 抽象设计

**日期**：2026-02-28  
**状态**：已批准

## 目标

1. 将 CasService / RealmService 重命名为 **CasFacade** / **RealmFacade**，避免与「服务端」语义混淆，适用于 client、SW、CLI、server 等任意运行环境。
2. **Delegate** 作为**实体名**：realm 内的工作空间/作用域，持久状态由 DelegateStore 存储；**DelegateFacade** 作为**访问句柄**：绑定到某 Delegate，带 access token 与有效期，承载所有按 delegate 的操作。RealmFacade 只做 realm 级能力（创建根 DelegateFacade、gc、info）。

本文档聚焦：**核心概念之间的关系**与**顶层类型/接口定义**。

---

## 1. 核心概念关系

```
                    ┌─────────────────┐
                    │   CasFacade     │  对 CAS 能力的门面（getNode/putNode/hasNode/gc/info）
                    │  (Level 0)      │  与运行位置无关
                    └────────┬────────┘
                             │ 依赖
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  RealmFacade (Level 1)                                                         │
│  · 仅 realm 级：createRootDelegate(realmId), gc(realmId), info(realmId)       │
│  · 依赖：CasFacade, DelegateStore                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
                             │
                             │ 创建 / 返回
                             ▼
                    ┌─────────────────┐
                    │ DelegateFacade   │  访问句柄：有限期（单 token+ttl）或无限期（access+refresh）
                    │  · token(s)     │  能力：getNode/hasNode/putNode/commit、
                    │  · 有效期        │    createChildDelegate、close；无限期另有 refresh
                    └────────┬────────┘
                             │
                             │ 绑定 / 操作
                             ▼
                    ┌─────────────────┐
                    │    Delegate      │  实体：有限期（单 token+ttl）或无限期（access+refresh）
                    │ (由 DelegateStore │  持久化 token hash、有效期等
                    │   持久化)         │
                    └─────────────────┘
```

- **CasFacade**：Level 0 门面，只关心 CAS 存储与 GC，不关心 Realm / Delegate。
- **RealmFacade**：Level 1 门面，只提供「按 realm」的入口；不暴露「按 delegateId」的 API。
- **Delegate**：**实体名**。realm 内的工作空间/作用域，分**有限期**（limited）与**无限期**（unlimited）两种访问模式；持久状态（含 token hash、有效期等）由 DelegateStore 持久化。
- **DelegateFacade**：**访问句柄**。绑定到某 Delegate 实体，有限期句柄带单 token + TTL，无限期句柄带 access + refresh 双 token；所有「按 delegate」的操作都通过 DelegateFacade（getNode、commit、createChildDelegate、close）。

---

## 2. 顶层类型定义

以下均为 **type**（符合 CODING-CONVENTIONS），仅描述形状与职责。

### 2.1 Cas 层

读写采用**流式**，避免大 node 在内存中完整缓冲；使用 Web 标准的 `ReadableStream<Uint8Array>`（Node 18+ 等环境均支持）。

```ts
/** 字节流类型：CAS 节点 body 的读写统一用流，支持流式透传。 */
type BytesStream = ReadableStream<Uint8Array>;

type CasStorage = {
  get(key: string): Promise<BytesStream | null>;
  put(key: string, value: BytesStream): Promise<void>;
  del(key: string): Promise<void>;
};

type CasContext = {
  storage: CasStorage;
  key: KeyProvider;  // from @casfa/core
};

type CasInfo = {
  /** 上次 GC 时间戳；从未执行过为 null */
  lastGcTime: number | null;
  nodeCount: number;
  totalBytes: number;
};

/** 读到的 CAS 节点：key + 节点序列化字节流（不缓冲整块）。 */
type CasNodeResult = {
  key: string;
  body: BytesStream;
};

type CasFacade = {
  getNode(key: string): Promise<CasNodeResult | null>;
  hasNode(key: string): Promise<boolean>;
  putNode(nodeKey: string, body: BytesStream): Promise<void>;
  gc(nodeKeys: string[], cutOffTime: number): Promise<void>;
  info(): Promise<CasInfo>;
};

// 工厂：createCasFacade(ctx: CasContext) => CasFacade
```

- 小 payload 可由调用方用单块 `Uint8Array` 包装成流（如 `new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } })`）再传入。

### 2.2 Delegate（实体）与 DelegateStore

Delegate 按访问模式分两类：

- **有限期 delegate（limited）**：单 token + TTL，过期即失效。创建时由调用方传入 **ttl**（ms），实现按服务配置截断最大 TTL。
- **无限期 delegate（unlimited）**：access + refresh 双 token。access 短期有效，refresh 用于换取新 access（及可选新 refresh）；无固定“最大有效期”，通过 refresh 延续。创建时 **不传 ttl** 即表示无限期。

持久化只存 token 的 hash，不存明文。

```ts
/** Delegate 公共字段：身份与挂载路径，有限期/无限期共用。 */
type DelegateBase = {
  delegateId: string;
  realmId: string;
  parentId: string | null;
  /** 唯一挂载路径（相对 parent），如 "foo" 或 "foo/bar" */
  mountPath: string;
};

/** 有限期 Delegate：单 token，过期即失效；创建时由 options.ttl 指定，并由服务配置截断。 */
type DelegateLimited = DelegateBase & {
  lifetime: 'limited';
  /** accessToken 的 hash，用于校验 */
  accessTokenHash: string;
  /** 过期时间（Unix 时间戳 ms） */
  expiresAt: number;
};

/** 无限期 Delegate：双 token；access 短期有效，refresh 用于换取新 access。 */
type DelegateUnlimited = DelegateBase & {
  lifetime: 'unlimited';
  /** 当前 access token 的 hash */
  accessTokenHash: string;
  /** refresh token 的 hash，仅用于 refresh 流程 */
  refreshTokenHash: string;
  /** 当前 access 的过期时间（Unix 时间戳 ms） */
  accessExpiresAt: number;
};

type Delegate = DelegateLimited | DelegateUnlimited;

type DelegateStore = {
  getDelegate(delegateId: string): Promise<Delegate | null>;
  getRoot(delegateId: string): Promise<string | null>;
  setRoot(delegateId: string, nodeKey: string): Promise<void>;
  listDelegates(realmId: string): Promise<Delegate[]>;
  insertDelegate(delegate: Delegate): Promise<void>;
  removeDelegate(delegateId: string): Promise<void>;
  /** 更新 delegate 的 mount path；若实现不需要路径变更可提供 no-op */
  updateDelegatePath(delegateId: string, newPath: string): Promise<void>;
  /** 标记 delegate 已关闭；若实现不需要可提供 no-op */
  setClosed(delegateId: string): Promise<void>;
  /**
   * 清理「过期时间早于给定时间戳」的 delegate，用于审计保留期后的定期清理。
   * 有限期 delegate：expiresAt < expiredBefore 的会被删除；无限期 delegate 由实现定义（如不参与或按 accessExpiresAt/撤销时间）。
   * @param expiredBefore Unix 时间戳（ms），过期早于此时间的 delegate 将被删除
   * @returns 实际删除的 delegate 数量
   */
  purgeExpiredDelegates(expiredBefore: number): Promise<number>;
};
```

- 访问校验：请求携带句柄时，用同一 hash 算法对 token 求 hash 与实体上的 hash 比对。有限期：校验 accessTokenHash 且当前时间 < expiresAt。无限期：日常请求校验 accessTokenHash 且当前时间 < accessExpiresAt；refresh 时校验 refreshTokenHash 后下发新 access（并可选轮换 refresh），同时更新实体的 accessTokenHash、accessExpiresAt（及可选 refreshTokenHash）。有限期最大 TTL 由服务配置决定，本层类型不写死。
- **当前根**：每个 Delegate 的「当前根」node key 仅通过 **DelegateStore.getRoot(delegateId)** / **setRoot(delegateId, nodeKey)** 读写，不纳入 Delegate 实体字段；commit 时由实现调 setRoot 更新。
- 过期清理：`purgeExpiredDelegates(expiredBefore)` 用于在审计保留期后定期删除已过期的 delegate。调用方传入 `expiredBefore = Date.now() - retentionMs`（如 30 天），则过期早于该时间点的 delegate 会被删除；有限期按 expiresAt 判断，无限期由实现决定是否参与及判断依据。

### 2.3 DelegateFacade（访问句柄）

有限期与无限期各有一种句柄形状；createRootDelegate / createChildDelegate 通过 options 的 **ttl** 区分：有 ttl → 有限期，无 ttl → 无限期；返回对应句柄类型（或联合类型由调用方窄化）。

```ts
/** DelegateFacade 公共字段与方法：路径均用 string（如 "a"、"foo/bar"），不支持 segments 数组。 */
type DelegateFacadeBase = {
  readonly delegateId: string;
  readonly accessToken: string;
  getNode(path: string): Promise<CasNodeResult | null>;
  hasNode(path: string): Promise<boolean>;
  putNode(nodeKey: string, body: BytesStream): Promise<void>;
  commit(newRootKey: string, oldRootKey: string): Promise<void>;
  createChildDelegate(relativePath: string, options: DelegateOptions): Promise<DelegateFacade>;
  /** 将当前 delegate 写回 parent 并失效/回收本句柄 */
  close(): Promise<void>;
};

/** 有限期 DelegateFacade：单 token + TTL；创建时由 options.ttl 指定，并由服务配置截断。 */
type DelegateFacadeLimited = DelegateFacadeBase & {
  readonly lifetime: 'limited';
  /** 过期时间（Unix 时间戳 ms） */
  readonly expiresAt: number;
};

/** 无限期 DelegateFacade：access + refresh 双 token；access 过期前可用 refresh 换取新 access（及可选新 refresh）。 */
type DelegateFacadeUnlimited = DelegateFacadeBase & {
  readonly lifetime: 'unlimited';
  readonly refreshToken: string;
  /** 当前 access 的过期时间（Unix 时间戳 ms） */
  readonly accessExpiresAt: number;
  /** 用 refreshToken 换取新的 access（及可选新 refresh），返回更新后的句柄 */
  refresh(): Promise<DelegateFacadeUnlimited>;
};

type DelegateFacade = DelegateFacadeLimited | DelegateFacadeUnlimited;

/**
 * 创建 Delegate 时的选项：用 ttl 区分有限期 / 无限期。
 * - 有 ttl（number，ms）：创建**有限期** delegate，单 token，过期即失效；实现按 maxLimitedTtlMs 截断。
 * - 无 ttl（不传或 undefined）：创建**无限期** delegate，access + refresh 双 token，通过 refresh 延续。
 */
type DelegateOptions = {
  ttl?: number;
};
```

- `commit` 即对当前绑定的 Delegate 做乐观锁更新根。
- `createChildDelegate` 即在当前 Delegate 下创建子 Delegate 实体并返回其 DelegateFacade；options 传 **ttl** 则子 delegate 为有限期，不传则为无限期。
- 有限期句柄的最大 TTL 由**服务/配置**（maxLimitedTtlMs）提供，不在本层类型中写死；无限期句柄通过 `refresh()` 延续，无单次写死的最大有效期。

### 2.4 RealmFacade（仅 realm 级）

```ts
type RealmFacadeContext = {
  cas: CasFacade;
  delegateStore: DelegateStore;
  /** 可选：有限期 delegate 最大 TTL（ms），创建时由实现按此截断 options.ttl；不在此层写死默认值 */
  maxLimitedTtlMs?: number;
};

type RealmFacade = {
  /** 创建绑定到该 realm 的 main Delegate 的根 DelegateFacade；options 传 ttl 为有限期，不传为无限期 */
  createRootDelegate(realmId: string, options: DelegateOptions): Promise<DelegateFacade>;
  gc(realmId: string, cutOffTime: number): Promise<void>;
  /** 查询指定 realm 的统计信息 */
  info(realmId: string): Promise<RealmInfo>;
};

type RealmInfo = {
  /** 上次 GC 时间戳；从未执行过为 null */
  lastGcTime: number | null;
  nodeCount: number;
  totalBytes: number;
  delegateCount: number;
};

// 工厂：createRealmFacade(ctx: RealmFacadeContext) => RealmFacade
```

- **RealmFacadeContext 与 StorageProvider**：Context 不包含 StorageProvider。Delegate 的持久化由 **DelegateStore** 抽象负责；调用方在外部根据运行环境构造好 DelegateStore（例如其实现内部使用 StorageProvider、远端 API 或内存），再注入 Context。RealmFacade 只依赖 DelegateStore 接口，不关心存储介质，职责更清晰、组合更灵活。
- **RealmFacadeContext 与 KeyProvider**：Context 不包含 KeyProvider。内容寻址 key 的计算（KeyProvider）是 **CasFacade** 的职责，由 CasContext 提供；RealmFacade 仅使用 CasFacade 与 DelegateStore（createRootDelegate / gc / info），不直接做节点 key 计算，因此不需要 KeyProvider。
- **错误与边界**：鉴权失败、token 过期、commit 时 oldRootKey 与当前根不一致等错误的语义与错误类型由实现定义，本设计不规定具体错误码或异常形状。
- RealmFacade **不再**提供 `getNode(delegateId, path)`、`commitDepot`、`createDepot`、`closeDepot` 等；调用方先 `createRootDelegate` 或通过已有 DelegateFacade 的 `createChildDelegate` 拿到 DelegateFacade，再在 DelegateFacade 上操作。

---

## 3. 实现与运行环境

- **本地**（CLI、SW）：RealmFacade 与 DelegateFacade 可由同一包（如 `@casfa/realm`）实现，底层使用 CasFacade + DelegateStore；token/有效期可为本地约定或简化（如固定 token、长期有效）。
- **远端**：DelegateFacade 可由 HTTP/RPC 客户端实现同一 `DelegateFacade` 类型，服务端校验 access token 与有效期后执行对应 delegate 操作；RealmFacade 的 `createRootDelegate` 可调用服务端接口领取根 DelegateFacade。
- 上层业务只依赖 **CasFacade、RealmFacade、DelegateFacade** 三个门面抽象，以及实体 **Delegate** 与 **DelegateStore**；不关心实现是本地还是远端。

---

## 4. 讨论：多层架构下的映射与同步

当前设计在单进程内是「RealmFacade + DelegateStore + CasFacade」同一地址空间；若采用 **浏览器页面 + Service Worker + 后端服务** 的三层架构，各层如何映射、如何同步，可以按下面方式理解（不写死实现，仅做概念映射与约定）。

### 4.1 角色与职责

- **Server（后端服务）**  
  - **权威数据**：DelegateStore、CAS 存储、token 签发与校验。  
  - 提供 **RealmFacade / DelegateFacade** 的「服务端实现」：  
    - `createRootDelegate(realmId, options)`、`createChildDelegate(...)` 在服务端创建 Delegate、存 DelegateStore、签发 token，并返回 **delegateId + accessToken（+ refreshToken 若无限期）** 及有效期。  
    - getNode、commit、close、refresh 等对应 HTTP/RPC 接口，请求体或头里带 **delegateId + accessToken**，服务端校验 token hash 与有效期后执行并返回结果。  
  - 不关心调用方是 Page 直连还是经 SW 转发；谁带有效 token 谁就有权操作该 delegate。

- **Page（浏览器页面）**  
  - 持有 **DelegateFacade 的「远端实现」**：同一 TypeScript 类型（DelegateFacade），但每个方法内部是 **发 HTTP 请求到 Server（或经 SW）**，请求中带上当前 facade 的 delegateId、accessToken（以及 path、payload 等）。  
  - 创建流程：Page 调「创建根/子 delegate」的 API（等价于 RealmFacade.createRootDelegate / DelegateFacade.createChildDelegate），Server 返回 delegateId + tokens + 过期时间；Page 用这些构造出本地的 DelegateFacade 句柄（仅存身份与 token，不存 CAS）。  
  - **Token 同步**：token 由 Server 签发，Page 只做「持有与随请求携带」；无限期时 Page 在 access 过期前调 refresh 接口，用 refreshToken 换新 accessToken（及可选新 refreshToken），并更新本地句柄上的 token。  
  - Page 不实现 DelegateStore/CAS；所有持久状态在 Server（及可选 SW 缓存）。

- **Service Worker（SW）**  
  - **定位**：可视为 Page 与 Server 之间的**代理与缓存层**。  
  - **代理**：Page 的请求可先到 SW，SW 再转发到 Server（并代为附加 token、cookie 等）。此时「谁持有 token」仍是 Page（或 Page 把 token 交给 SW 存于 worker 内）；SW 只做转发与可选缓存。  
  - **缓存**：SW 可缓存 CAS 节点（key → blob）、甚至缓存部分 delegate 的「当前根」或路径解析结果，以加速重复访问或做离线可用。缓存策略（何时失效、何时回源）由实现决定，不改变「Server 为 CAS/Delegate 权威」的约定。  
  - **Token 在 SW 的同步**：若 Page 与 SW 需共享同一 delegate 会话，可由 Page 在拿到 DelegateFacade 后通过 postMessage / BroadcastChannel 等把 delegateId + tokens 交给 SW，或由 SW 在首次代理时向 Server 申领/刷新 token（若实现上 Server 支持按 session 等发 token）。同一 delegate 的 token 在 Page 与 SW 之间只需「逻辑上一致」，不要求多端实时同步写；通常以 Server 签发为准，任一端 refresh 后把新 token 写回共享存储或通知另一端即可。

### 4.2 概念映射小结

| 概念           | 单进程内                         | Page + SW + Server 下                                                                 |
|----------------|----------------------------------|----------------------------------------------------------------------------------------|
| RealmFacade    | 本地实现，直接调 DelegateStore/Cas | Page 不持有一份；创建根/子 delegate 通过调用 Server 的「创建 delegate」API 完成。     |
| DelegateFacade | 本地句柄，直接调 CasFacade/Store  | Page/SW 持有一份「远端句柄」：同一类型，方法实现为 HTTP + delegateId/token 的 RPC。     |
| DelegateStore  | 本地存储                         | 仅 Server 侧；Page/SW 不直接读写，仅通过 token 间接操作。                              |
| CAS            | 本地 CasFacade                   | Server 为权威；SW 可做只读缓存（key → 流/缓存），失效策略自定。                          |
| Token          | 进程内引用                       | Server 签发；Page（及可选 SW）持有并随请求携带；refresh 由 Server 处理并返回新 token。 |

### 4.3 同步要点

- **Delegate 与 token**：以 Server 为唯一真实来源。创建/refresh 只在 Server 发生；Page/SW 只保存并携带 token，不做「多端 DelegateStore 同步」。  
- **CAS 内容**：以 Server 为权威；SW 缓存仅为性能/离线，需定义失效规则（如按 key 的版本、按 commit 版本或 TTL）。  
- **有限期 / 无限期**：语义不变。有限期 = 带 ttl 的 token，过期即失效，不可 refresh。无限期 = 带 refreshToken，由 Server 在 refresh 接口中签发新 access（及可选新 refresh）。各层只需按同一 DelegateOptions（有无 ttl）和同一 token 形状与 Server 约定一致即可。

若后续有「离线优先」「SW 本地 DelegateStore」等需求，可在本设计之上再加一层「本地 RealmFacade + 与 Server 的同步协议」，而不改变当前文档中的类型与职责划分。

### 4.4 讨论：大 Node 的访问与传输

当 node 体积较大时，若服务端每次都从 Storage（如 S3）读满再返回、或收满请求体再写入，会带来高延迟、高内存和带宽占用。下面几种方式可组合使用，实现时按需选择。

- **流式透传（streaming）**  
  - **读**：服务端从 Storage 拉流（如 S3 GetObject 的 stream），不缓存在内存，直接 pipe 到响应体；客户端按流消费。  
  - **写**：客户端按流上传，服务端不缓冲完整 body，边收边转发到 Storage（如 S3 分片上传或 stream put）。  
  - 本设计已采用：**CasStorage / CasFacade / DelegateFacade** 的读写均使用 `BytesStream`（ReadableStream<Uint8Array>），不接 Uint8Array，便于各层流式透传。

- **预签名 URL / 直连 Storage（推荐用于超大对象）**  
  - **读**：服务端只做鉴权与 key 校验，通过 302 或响应体返回**预签名 GET URL**（如 S3 Presigned Get）；客户端用该 URL 直连 Storage 拉取，服务端不接触数据。  
  - **写**：服务端校验 delegate 与配额后返回**预签名 PUT URL**；客户端直连 Storage 上传；上传完成后客户端再调服务端接口（如「确认已写入 key X」），服务端更新 CAS 索引 / delegate 根等元数据。  
  - 适用：大文件、大 blob；服务端零数据拷贝、带宽与 CPU 压力最小；需保证预签名 URL 的过期时间与权限范围可控。

- **Range 请求（按需分段读）**  
  - 对 getNode 支持 **Range** 语义（或单独的大 blob 读取接口）：请求带 `Range: bytes=0-1023`，Storage 与响应只返回该区间。  
  - 适用：视频拖拽、大文件局部读、分页加载；减少单次传输量与延迟。

- **CDN / 边缘缓存**  
  - 对只读或幂等的 CAS 读，可在 Storage 前加 CDN（如 CloudFront）；首次回源后由边缘节点响应，降低回源带宽与延迟。  
  - 需约定缓存 key（通常即 CAS key）与失效策略（如按版本、按 commit 或 TTL）。

- **分层与分片**  
  - 大「逻辑 node」在 CAS 层拆成多个小 node（如大文件拆成多个 successor node）；客户端按路径/偏移请求所需片段，避免单次 getNode 返回整块。  
  - 与现有 CAS 节点模型兼容；主要影响内容如何切分与索引，不改变门面类型。

**建议**：门面已统一为流式（getNode 返回 `CasNodeResult` 含 `body: BytesStream`，putNode 接受 `BytesStream`）；若需 **Range** 或**预签名直连**，可在实现层对同一流式接口做扩展（如 Range 头、或返回重定向 URL），而不改变本顶层类型。

---

## 5. 后续

- 实现计划（重命名 Facade、Depot → Delegate / DelegateStore、引入 DelegateFacade 与 RealmFacade 收缩、迁移调用方）由 writing-plans 产出。
- 本设计依赖 **KeyProvider**（@casfa/core）与 **ReadableStream**（Web/Node 标准），不在此文档重复定义。
