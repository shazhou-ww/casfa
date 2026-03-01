# server-next 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 Branch/Delegate/Realm 概念与路径型 REST API 设计，实现全新 server-next 应用，支持 User（OAuth）、Delegate（长期授权）、Worker（Branch token）三种主体，提供文件访问（**单 node 文件，约 4MB**）、Branch 管理、Delegate 授权管理及 MCP 集成。

**Architecture:** 新建 `apps/server-next`，Hono + Bun；统一 Bearer 鉴权中间件解析 OAuth AT（User/Delegate）与 Branch Token（Worker），输出 auth 上下文（形态为 discriminated union，见 [module-design](./2026-03-01-server-next-module-design.md) §2）；Realm 层使用 @casfa/realm + @casfa/cas（当前 realm 的「Delegate」实体即我们的 Branch，close→complete 语义）；新增 Delegate 授权存储（长期授权记录）；文件 API 以 path 段形式 `/api/realm/:realmId/files/*path`，**首版仅支持单 node 文件**（约 4MB，单 node 上限），无 nodes/check、nodes/raw、commit、manifest；先实现单机/本地存储。

**Tech Stack:** Bun, Hono, TypeScript, @casfa/realm, @casfa/cas, @casfa/core；可选 @casfa/storage-fs 或 @casfa/storage-memory；OAuth 可复用 @casfa/oauth-provider 或先 mock。

**依据文档:**  
- [2026-03-01-requirements-use-cases.md](./2026-03-01-requirements-use-cases.md)  
- [2026-03-01-server-next-api-design.md](./2026-03-01-server-next-api-design.md)  
- [2026-03-01-server-next-module-design.md](./2026-03-01-server-next-module-design.md)（模块划分、AuthContext、Service/Controller 接口）  
- [2026-03-01-file-chunk-upload-download.md](./2026-03-01-file-chunk-upload-download.md)（大文件设计，首版不实现）

**实现前审阅**：见 [2026-03-01-server-next-plan-review.md](./2026-03-01-server-next-plan-review.md)（慢查询、Lambda 超时、内存、一致性、存储索引及对计划的补充建议）。

**派生数据（Derived Data）**：见 [2026-03-01-derived-data-design.md](./2026-03-01-derived-data-design.md)。**首版**仅使用 path_index、dir_entries、realm_stats（不实现 reachable_set、file_manifest）。Phase 2 增加 DerivedDataStore；path 解析、list 等读路径优先读派生数据，未命中再算并回填。

---

## Phase 0：准备与约定

- 实现顺序按 Phase 1 → Phase 8 执行；每 Phase 内按 Task 顺序，每 Task 内按 Step 顺序。
- 代码风格遵循 [docs/CODING-CONVENTIONS.md](../CODING-CONVENTIONS.md)：`type` 不用 `interface`，create 函数返回对象，path 用 `string`。
- 命名约定：API 与类型中的「Branch」= 任务型分支（对应 @casfa/realm 的 Delegate 实体）；「Delegate」= 长期授权（server-next 新增的 DelegateGrant 存储）。

---

## Phase 1：应用骨架

### Task 1.1：创建 server-next 包与入口

**Files:**  
- Create: `apps/server-next/package.json`  
- Create: `apps/server-next/tsconfig.json`  
- Create: `apps/server-next/src/index.ts`  
- Create: `apps/server-next/src/app.ts`

**Step 1:** 创建 `apps/server-next/package.json`，name 为 `@casfa/server-next`，type module，scripts：`dev`（bun run src/index.ts）、`typecheck`（tsc --noEmit）、`test`（bun test）。依赖：hono、@casfa/realm、@casfa/cas、@casfa/core；devDependencies：typescript、@types/bun。

**Step 2:** 创建 `tsconfig.json`，extends 或兼容 root 的 module/ESNext，include src。

**Step 3:** 创建 `src/index.ts`：从 `./app.ts` 引入 createApp，load 配置（env 或默认），调用 createApp(deps)，Bun.serve({ port, fetch: app.fetch })。

**Step 4:** 创建 `src/app.ts`：导出 `createApp(deps)`，内部 new Hono()，挂 GET /api/health 返回 200 JSON `{ ok: true }`，GET /api/info 返回 storageType/authType（可写死），返回 app。

**Step 5:** 在 repo 根执行 `bun run typecheck`（需把 server-next 加入 typecheck 脚本或单独 `cd apps/server-next && bun run typecheck`）。Expected: PASS。

**Step 6:** Commit：`git add apps/server-next && git commit -m "chore(server-next): add app skeleton" -m "Hono + Bun entry, health and info endpoints."`

---

### Task 1.2：统一 Env 与错误格式

**Files:**  
- Create: `apps/server-next/src/types.ts`  
- Modify: `apps/server-next/src/app.ts`

**Step 1:** 在 `src/types.ts` 定义 `Env`：Bindings 含 `auth?: AuthContext`。定义 **AuthContext 为 discriminated union**（见 [module-design](./2026-03-01-server-next-module-design.md) §2）：`UserAuth`（仅 userId）、`DelegateAuth`（realmId, delegateId, clientId, permissions）、`WorkerAuth`（realmId, branchId, access: "readonly"|"readwrite"）。定义统一错误响应与 ErrorBody。

**Step 2:** 定义统一错误响应：`errorResponse(code: string, message: string, status: number)` 返回 `c.json({ error, message }, status)`。

**Step 3:** 在 app 中挂 onError：未捕获异常返回 500 与统一错误体。

**Step 4:** Commit：`git add apps/server-next/src/types.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): add Env, AuthContext, and error response shape"`

---

## Phase 2：配置与存储

### Task 2.1：配置加载

**Files:**  
- Create: `apps/server-next/src/config.ts`

**Step 1:** 实现 `loadConfig()`：读取 `process.env`，返回对象：port、storage（type: memory|fs, fsPath?）、auth（mockJwtSecret?, maxBranchTtlMs?）。默认 port 8802，storage memory。

**Step 2:** 在 `src/index.ts` 中调用 loadConfig，将 config 传入 createApp。

**Step 3:** Commit：`git add apps/server-next/src/config.ts apps/server-next/src/index.ts && git commit -m "feat(server-next): add config loading"`

---

### Task 2.2：CAS + Realm 依赖注入

**Files:**  
- Create: `apps/server-next/src/services/cas.ts`  
- Create: `apps/server-next/src/services/realm.ts`  
- Modify: `apps/server-next/src/app.ts`

**Step 1:** 实现 `createCasFacade(config)`：根据 config.storage 使用 @casfa/storage-memory 或 @casfa/storage-fs，创建 KeyProvider（可复用 @casfa/core 或简单 hash），返回 createCasFacade(context) 的实例。

**Step 2:** 实现 `createRealmFacade(cas, config)`：创建 DelegateStore（见下）；当前使用 @casfa/realm 的 DelegateStore 接口，可用 memory-delegate-store 或自写一层）。注意：realm 的「Delegate」实体在本计划中即「Branch」；getRootDelegate 即获取/创建 root branch。调用 createRealmFacade(context)，返回 facade。

**Step 3:** DelegateStore 实现：若用内存，实现 getDelegate(getRootDelegate)、getRoot、setRoot、listDelegates、insertDelegate、removeDelegate、updateDelegatePath、setClosed、purgeExpiredDelegates。getRootDelegate(realmId) 需返回该 realm 的 root「Delegate」实体（即 root branch）。

**Step 4:** 在 app 的 createApp(deps) 中注入 config、cas、realm；deps 类型集中定义在 types 或 app 入参。

**Step 5:** Commit：`git add apps/server-next/src/services/cas.ts apps/server-next/src/services/realm.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): wire CasFacade and RealmFacade with in-memory store"`

---

### Task 2.3：Delegate 授权存储（长期授权）

**Files:**  
- Create: `apps/server-next/src/db/delegate-grants.ts`

**Step 1:** 定义 `DelegateGrant` type：realmId、delegateId、clientId、accessTokenHash、refreshTokenHash?、createdAt、expiresAt?、permissions（string[]）。

**Step 2:** 实现内存版 DelegateGrantStore：list(realmId)、get(delegateId)、getByAccessTokenHash(realmId, hash)、insert、remove、updateTokens。用于「用户主动分配」与 OAuth 授权后签发 token 的绑定。

**Step 3:** 在 app 依赖中注入 delegateGrantStore（或通过 services 暴露）。

**Step 4:** Commit：`git add apps/server-next/src/db/delegate-grants.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): add DelegateGrant store for long-term auth"`

---

### Task 2.4：派生数据存储（Derived Data）

**Files:**  
- Create: `apps/server-next/src/db/derived-data.ts`

**Step 1:** 定义派生数据存储接口：`get(nodeKey: string, deriveKey: string): Promise<unknown | null>`、`set(nodeKey: string, deriveKey: string, data: unknown): Promise<void>`。data 为可序列化结构（见 [2026-03-01-derived-data-design.md](./2026-03-01-derived-data-design.md)）。

**Step 2:** 实现内存版：Map 键为 `\`${nodeKey}\`:\`${deriveKey}\``，值为 data。可选支持按 realm_id 隔离（键加 realm_id 前缀）。

**Step 3:** 在 app 依赖中注入 derivedDataStore。后续 Phase 4 的 path 解析、list 在实现时优先读此存储（path_index、dir_entries、realm_stats），未命中再现场计算并回填。

**Step 4:** Commit：`git add apps/server-next/src/db/derived-data.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): add DerivedData store for path_index, dir_entries, realm_stats"`

---

## Phase 3：鉴权中间件

### Task 3.1：Bearer 解析与 User/Delegate/Worker 判定

**Files:**  
- Create: `apps/server-next/src/middleware/auth.ts`

**Step 1:** 实现 `createAuthMiddleware(deps)`：deps 含 jwtVerifier（可选）、delegateGrantStore、realmFacade（或 branch 存储）。从 `Authorization: Bearer <token>` 取 token。

**Step 2:** 若 token 含 `.` 视为 JWT（或 OAuth AT）：调用 jwtVerifier(token)。得到 sub（userId）。若 delegateGrantStore.getByAccessTokenHash(realmId, hash(token)) 有记录（realmId 可用 userId 代替查询，当前 1:1），则 auth.type=delegate，auth.realmId=grant.realmId，auth.delegateId=grant.delegateId，auth.clientId=grant.clientId，auth.permissions=grant.permissions；否则 auth.type=user，auth.userId=sub（**不设 realmId/permissions**）。

**Step 3:** 若 token 不含 `.`，视为 Branch token：解码（约定格式，如 base64 的 branchId + 签名或查表）。查 Branch 存储（即 realm 的 DelegateStore）得到 Branch 实体；校验 hash、expiresAt；设置 auth.type=worker，auth.realmId=branch.realmId，auth.branchId=branch.delegateId，auth.access="readwrite"（或按配置 readonly）。

**Step 4:** 将 auth 写入 c.set('auth', auth)，next()。无 token 或校验失败返回 401 统一错误体。

**Step 5:** 在 app 中挂载：`/api/realm/*` 使用 auth 中间件；`/api/health`、`/api/info`、`/.well-known/*` 不鉴权。

**Step 6:** 单元测试：`apps/server-next/tests/middleware/auth.test.ts`，mock jwtVerifier 与 store，断言 Bearer JWT 得到 user 上下文、Bearer branchToken 得到 worker 上下文、无 header 得到 401。

**Step 7:** 运行 `bun test apps/server-next/tests`，通过后 commit：`git add apps/server-next/src/middleware/auth.ts apps/server-next/tests/middleware/auth.test.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): add auth middleware (User/Delegate/Worker)"`

---

### Task 3.2：realmId 解析与 realm 访问校验

**Files:**  
- Create: `apps/server-next/src/middleware/realm.ts`

**Step 1:** 实现 `createRealmMiddleware()`：在 auth 之后运行；读 `c.req.param('realmId')`，若为 `me` 则替换为 **有效 realmId**（User 时为 auth.userId，Delegate/Worker 时为 auth.realmId）；校验 param 与有效 realmId 一致，否则 403。

**Step 2:** 挂到 `/api/realm/:realmId/*` 路由组。

**Step 3:** Commit：`git add apps/server-next/src/middleware/realm.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): realm param resolution and realmId check"`

---

## Phase 4：文件 API（path 段 + 当前根解析）

### Task 4.1：解析「当前根」与 path 到 nodeKey

**Files:**  
- Create: `apps/server-next/src/services/root-resolver.ts`

**Step 1:** 实现 `getCurrentRoot(auth, realmFacade)`：若 auth.type===user 或 auth.type===**delegate**，则 **realmId** 取 auth.userId（user，当前 1:1）或 auth.realmId（delegate），realmFacade.getRootDelegate(realmId, {}) 得到 root facade，再 getRoot() 或等价得到 nodeKey；若 auth.type===worker，则从 Branch 存储取该 auth.branchId 的 getRoot(branchId) 得到 nodeKey。返回 nodeKey。

**Step 2:** 实现 `resolvePath(cas, keyProvider, rootKey, pathStr)`：path 规范化（trim /、禁止 ..），按 "/" 拆段，从 rootKey 起逐段解析 dict 子节点，返回最终 nodeKey 或 null。依赖 @casfa/core 的 decodeNode、hashToKey 等。

**Step 3:** 单元测试：resolvePath 对空 path 返回 rootKey；对 "a/b" 返回对应子 node key（mock cas.getNode）。

**Step 4:** Commit：`git add apps/server-next/src/services/root-resolver.ts apps/server-next/tests/services/root-resolver.test.ts && git commit -m "feat(server-next): resolve current root and path to nodeKey"`

---

### Task 4.2：GET 文件列表与 GET 文件元数据

**Files:**  
- Create: `apps/server-next/src/controllers/files.ts`

**Step 1:** 实现 `list(c)`：取 auth、realmId、path（从 *path 或 query）；getCurrentRoot + resolvePath；若 node 为 dict，返回 children 列表（name、size、kind 等）。权限：file_read。

**Step 2:** 实现 `stat(c)` 或 `getMeta(c)`：path 解析到 nodeKey；若为 file 返回 size、contentType；若为 dict 返回 kind=directory。用于 GET .../files/*path?meta=1。

**Step 3:** 路由：GET `/api/realm/:realmId/files`、GET `/api/realm/:realmId/files/*`，调用 list；GET with meta=1 或单独 GET .../files/*path 且无 Accept 流式则返回 stat。

**Step 4:** 集成测试或手测：带 Bearer token 请求 list/stat，返回 200 与预期 JSON。

**Step 5:** Commit：`git add apps/server-next/src/controllers/files.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): files list and stat endpoints"`

---

### Task 4.3：GET 文件下载（流式 + Range）

**Files:**  
- Modify: `apps/server-next/src/controllers/files.ts`

**Step 1:** 实现 `download(c)`：path 解析到 file nodeKey；**首版仅单 node 文件**：读取该 f-node 的 data 段，返回完整 body；设置 Content-Type、Content-Length。

**Step 2:** 路由：GET `/api/realm/:realmId/files/*path` 且 Accept 或无 meta 时走 download。

**Step 3:** Commit：`git add apps/server-next/src/controllers/files.ts && git commit -m "feat(server-next): file download with streaming and Range"`

---

### Task 4.4：PUT 小文件上传（整文件，≤ 6MB）

**Files:**  
- Modify: `apps/server-next/src/controllers/files.ts`

**Step 1:** 实现 `upload(c)`：path 为父目录路径 + 文件名；读取 req.body 并缓冲（**限制 maxBody 为单 node 大小，约 4MB**），调用 @casfa/core 的 encodeFileNode + putNode 得到单个 fileNodeKey；在当前根下用 replaceSubtreeAtPath 或等价将 path 指向 fileNodeKey，得到 newRootKey；调用 realm commit(oldRootKey, newRootKey)。当前根来自 getCurrentRoot(auth)。

**Step 2:** 路由：PUT `/api/realm/:realmId/files/*path`，需 file_write 权限。

**Step 3:** Commit：`git add apps/server-next/src/controllers/files.ts && git commit -m "feat(server-next): PUT file upload (small file, single request)"`

---

### Task 4.5：fs 操作（mkdir, rm, mv, cp）

**Files:**  
- Create: `apps/server-next/src/controllers/fs.ts`

**Step 1:** 实现 mkdir、rm、mv、cp，均基于当前根 + path 解析，调用 realm/cas 的 dict 操作（新建 dict、替换子节点、删除子节点等），最后 commit。请求体与路由见 API 设计 §4.4（POST .../fs/mkdir 等）。

**Step 2:** 挂路由，权限 file_write。

**Step 3:** Commit：`git add apps/server-next/src/controllers/fs.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): fs mkdir, rm, mv, cp"`

---

## Phase 5：Branch API

### Task 5.1：创建 Branch（root 下与子 Branch）

**Files:**  
- Create: `apps/server-next/src/controllers/branches.ts`

**Step 1:** 实现 `create(c)`：body mountPath、ttl、可选 parentBranchId。若无 parentBranchId，则 caller 须为 user 或 delegate，parent=realm root：调用 realmFacade.getRootDelegate(realmId)，再 facade.createChildDelegate(mountPath, { ttl })；若有 parentBranchId，则 caller 须为 worker 且 auth.branchId===parentBranchId，在对应 parent 上 createChildDelegate。返回 branchId、accessToken（Branch token）、expiresAt。Branch token 编码：可存 (branchId, hash(secret))，或复用 @casfa/delegate-token 格式。

**Step 2:** 路由：POST `/api/realm/:realmId/branches`，权限 branch_manage（user/delegate）或当前 branch 的 worker。

**Step 3:** Commit：`git add apps/server-next/src/controllers/branches.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): POST branches (create root child or sub-branch)"`

---

### Task 5.2：列出与撤销 Branch、Complete Branch

**Files:**  
- Modify: `apps/server-next/src/controllers/branches.ts`

**Step 1:** 实现 `list(c)`：realmId 下 listDelegates（即 Branch 列表），过滤 closed，返回 branchId、mountPath、expiresAt、parentId 等。仅 user/delegate 可调；worker 不可或仅可见自身（按权限配置）。

**Step 2:** 实现 `revoke(c)`：POST .../branches/:branchId/revoke，removeDelegate(branchId) 或标记失效，使对应 token 失效。

**Step 3:** 实现 `complete(c)`：POST .../branches/me/complete（或 :branchId），仅 worker 且 branchId 为当前 auth.branchId；调用 facade.close()（即 merge 回 parent），再 removeDelegate 或标记失效。

**Step 4:** 路由：GET branches、POST branches/:id/revoke、POST branches/me/complete。

**Step 5:** Commit：`git add apps/server-next/src/controllers/branches.ts && git commit -m "feat(server-next): branches list, revoke, complete"`

---

## Phase 6：Delegate 授权管理 + OAuth 端点

### Task 6.1：Delegate 列表、撤销、用户主动分配

**Files:**  
- Create: `apps/server-next/src/controllers/delegates.ts`

**Step 1:** 实现 `list(c)`：GET .../delegates，仅 auth.type===user 且 delegate_manage；返回 delegateGrantStore.list(realmId)。

**Step 2:** 实现 `revoke(c)`：POST .../delegates/:delegateId/revoke，删除 grant，使该 delegate 的 token 失效。

**Step 3:** 实现 `assign(c)`：POST .../delegates/assign，body ttl、可选 client_id；生成 delegateId、accessToken（及可选 refreshToken），写入 delegateGrantStore，返回 token 与 expiresAt。用于「用户主动分配」给客户端。

**Step 4:** 路由挂载，权限 delegate_manage。

**Step 5:** Commit：`git add apps/server-next/src/controllers/delegates.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): delegates list, revoke, assign"`

---

### Task 6.2：OAuth 元数据与 token 端点（最小可用）

**Files:**  
- Create: `apps/server-next/src/controllers/oauth.ts`

**Step 1:** 实现 GET `/.well-known/oauth-authorization-server`：返回 issuer、authorization_endpoint、token_endpoint、jwks_uri（若用 JWT）等，与现有 server 或 RFC 8414 对齐。

**Step 2:** 实现 POST `/api/auth/token`：支持 grant_type=authorization_code（换 code 为 access_token）、grant_type=refresh_token。authorization_code 时校验 code 与 redirect_uri，若 code 关联到 Delegate 授权，则签发 access_token（可 JWT 或 opaque）并绑定到该 DelegateGrant；refresh_token 时校验 refresh 并签发新 access。

**Step 3:** 实现 GET `/api/auth/authorize/info`：校验 client_id、redirect_uri、scope 等，返回展示用信息。POST `/api/auth/authorize`：用户批准后创建 DelegateGrant 并生成 code，重定向回 client。

**Step 4:** 路由挂载；无 auth 中间件。

**Step 5:** Commit：`git add apps/server-next/src/controllers/oauth.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): OAuth metadata and token/authorize endpoints"`

---

## Phase 7：usage、gc、GET realm 信息

### Task 7.1：usage、gc、GET realm 信息

**Files:**  
- Create: `apps/server-next/src/controllers/realm.ts`

**Step 1:** 实现 GET `/api/realm/:realmId`：返回 realm 摘要（可含 usage）；调用 realmFacade.info(realmId)。

**Step 2:** 实现 GET `/api/realm/:realmId/usage`：返回 nodeCount、totalBytes 等（来自 cas.info 或 realm.info，优先派生数据 realm_stats）。

**Step 3:** 实现 POST `/api/realm/:realmId/gc`：body cutOffTime；调用 realmFacade.gc(realmId, cutOffTime)。权限：user 或 delegate（可配置）。

**Step 4:** 路由挂载。

**Step 5:** Commit：`git add apps/server-next/src/controllers/realm.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): realm info, usage, gc"`

---

## Phase 8：MCP 与收尾

### Task 8.1：MCP 入口

**Files:**  
- Create: `apps/server-next/src/mcp/handler.ts`  
- Modify: `apps/server-next/src/app.ts`

**Step 1:** 实现 POST `/api/mcp`：要求 Bearer token（auth 中间件）；从 c.get('auth') 取 **有效 realmId**（user 时为 userId，delegate/worker 时为 realmId）、branchId（仅 worker）；MCP 请求体解析后，将文件/Branch 操作转发到内部服务（同 REST 使用的 root-resolver、files、branches），返回 MCP 响应格式。可参考现有 apps/server 的 mcp/handler。

**Step 2:** 路由挂载在 auth 之后。

**Step 3:** Commit：`git add apps/server-next/src/mcp/handler.ts apps/server-next/src/app.ts && git commit -m "feat(server-next): MCP handler with shared auth and realm scope"`

---

### Task 8.2：CORS、404、根路径 path 段约定

**Files:**  
- Modify: `apps/server-next/src/app.ts`

**Step 1:** 挂 CORS 中间件（allow origin/headers/methods 按需）。

**Step 2:** 约定 `/api/realm/:realmId/files/*` 中 * 为 path 段：如 `/api/realm/me/files/foo/bar` 表示 path `/foo/bar`。在 files/fs 控制器中从 `c.req.param('path')` 或 path 段拼接取 path，做规范化。

**Step 3:** 404 处理：返回统一错误体。

**Step 4:** Commit：`git add apps/server-next/src/app.ts && git commit -m "chore(server-next): CORS, 404, path segment convention"`

---

### Task 8.3：README 与根 scripts 集成

**Files:**  
- Create: `apps/server-next/README.md`  
- Modify: `package.json`（repo root，可选）

**Step 1:** README 简述 server-next 用途、概念（Branch/Delegate/Realm）、如何运行（bun run dev）、环境变量、与 [docs/plans/2026-03-01-server-next-api-design.md](../plans/2026-03-01-server-next-api-design.md) 的链接。

**Step 2:** 若需在根 typecheck/test 中包含 server-next，在 root package.json 的 scripts 中加入相应 cd 命令。

**Step 3:** Commit：`git add apps/server-next/README.md package.json && git commit -m "docs(server-next): README and root scripts"`

---

## 执行方式建议

- **Subagent-Driven（本 session）**：按 Phase/Task 逐项派发子 agent，每完成一项做一次 code review，再进入下一项。  
- **Parallel Session**：在新 session 中打开 worktree，使用 executing-plans 按 checkpoint 批量执行，每完成一个 Phase 检查一次。

完成上述全部 Task 后，server-next 具备：健康/信息、统一鉴权（User/Delegate/Worker，discriminated union）、文件 list/stat/download/upload（**单 node 文件约 4MB**）、fs mkdir/rm/mv/cp、Branch 创建/列表/撤销/complete、Delegate 列表/撤销/assign、OAuth 元数据与 token/authorize、realm info/usage/gc、MCP。**首版不包含** nodes/check、nodes/raw、commit、manifest。后续可补：大文件分块（见 file-chunk 文档）、预签名 URL、e2e 测试与 OpenAPI 导出。
