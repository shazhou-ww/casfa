# server-next E2E 测试设计

> 设计日期：2026-03-01。Brainstorming 结论：in-memory 进程内启动服务，冒烟 + User/Delegate/Worker/MCP 多路径覆盖。

## 1. 目标与范围

- **目标**：为 server-next 补充 e2e，在 **in-memory、进程内启动一次服务** 的前提下覆盖：
  - **冒烟**：`/api/health`、`/api/info`、无鉴权 401、404、CORS（可选）
  - **User 路径**：Mock JWT 作为 User → 某 realm 下文件 list/stat/upload + fs mkdir/rm 等至少一条完整 CRUD
  - **Delegate 路径**：User 调 delegates/assign 拿 token → 用该 token 访问 realm（如 list files 或 list branches）
  - **Worker 路径**：User 或 Delegate 创建 branch，用返回的 branch token 作为 Worker → 调 fs_ls 或 list branches，可选 MCP tools/call
  - **MCP**：同一服务上 POST `/api/mcp`，Bearer 为 User 或 Worker token → initialize、tools/list、至少一个 tools/call（如 fs_ls 或 branches_list）

- **约束**：不依赖 Docker/外部服务，仅内存存储；与现有单元测试并存（e2e 放在 `e2e/`，单元测试保持在 `tests/`）。

- **成功标准**：`bun run test:e2e`（或 `bun test e2e/`）本地一次通过，覆盖上述路径；CI 可只跑 in-memory，无需 DynamoDB/容器。

## 2. 启动方式与生命周期

- **进程内单例**：e2e 不启子进程，在同一进程内用 `createApp(deps)` 得到 Hono app，`Bun.serve({ fetch: app.fetch, port: 0 })` 起真实 HTTP 服务；`port: 0` 由系统分配，避免与已有 dev 冲突。
- **依赖构造**：在 `e2e/setup.ts` 中用 in-memory 构造与 `index.ts` 一致的 deps：`loadConfig()` 并覆盖/注入 `STORAGE_TYPE=memory`、`MOCK_JWT_SECRET=test-secret-e2e`；`createCasFacade`、`createRealmFacade`、`createDelegateGrantStore`、`createDerivedDataStore`、`createDelegateStore` 等与 `index.ts` 一致，再 `createApp(deps)`。
- **何时 createApp / 何时 stop**：
  - 整次 e2e 运行**共用一个 server**。setup 暴露 `startTestServer()`，返回 `{ url, stop, helpers }`；e2e 入口或第一个 describe 的 `beforeAll` 里 `await startTestServer()` 并存到共享 context，所有 e2e 文件复用同一 `url`；最外层 `afterAll` 调用 `stop()`。
  - 用例隔离靠**每个 test 使用不同 realmId**（如 `realmId = 'e2e-' + randomUUID()`），不在 test 间共享 realm。
- **环境变量**：e2e 启动前设置 `process.env.STORAGE_TYPE=memory`、`process.env.MOCK_JWT_SECRET=test-secret-e2e`（若未设）；不读 `.env`，保证可重复、无外部依赖。
- **失败与清理**：`Bun.serve` 失败则直接抛错；`stop()` 仅在正常/异常退出路径调用一次。

## 3. 用例结构与文件划分

- **e2e 根目录**：`apps/server-next/e2e/`；运行命令为 `bun test e2e/` 或 script `test:e2e`。
- **文件与覆盖**：

| 文件 | 覆盖 |
|------|------|
| **e2e/setup.ts** | 设 env、`startTestServer()`、`TestHelpers`；被各 e2e 文件 import。 |
| **e2e/health.test.ts** | 冒烟：GET `/api/health` 200、GET `/api/info` 200、GET 不存在的 path 404、无 Authorization 时 GET `/api/realm/me` 401；可选 CORS 的 it。 |
| **e2e/files.test.ts** | User 路径：Mock JWT 访问某 realm；list 空根、mkdir 再 list、upload 小文件、stat、download 一致；可选 rm 或再 list。 |
| **e2e/delegates.test.ts** | Delegate 路径：User token 调 POST delegates/assign 拿 token；用该 token 调 GET realm files 或 branches 得 200；可选 revoke 后再请求得 401/403。 |
| **e2e/branches.test.ts** | Branch/Worker 路径：User 调 POST branches 拿 branchId + accessToken；用 branch token 作 Bearer 调 GET realm/me/files 或 list branches；可选 MCP tools/call fs_ls 或 branches_list。 |
| **e2e/mcp.test.ts** | MCP：Bearer 为 User 或 Worker token；POST `/api/mcp` initialize、tools/list、至少一个 tools/call 返回 content。 |

- CORS 可放在 health.test.ts 的一个 it；fs（mkdir/rm/mv/cp）在 files 路径中顺带覆盖，不单独建 fs.test.ts。

## 4. Helpers 与 fixture

- **createUserToken(realmId)**：用 e2e 的 `MOCK_JWT_SECRET` 签发 JWT，`sub = realmId`；返回 token 字符串。
- **authRequest(token, method, path, body?)**：对 `url + path` 发请求，`Authorization: Bearer <token>`，有 body 时 JSON；返回 `Promise<Response>`。
- **assignDelegate(userToken, realmId, options?)**：用 userToken 调 POST realm/delegates/assign；返回 `{ accessToken, delegateId, expiresAt? }`。
- **createBranch(userToken, realmId, body)**：用 userToken 调 POST realm/branches，body 至少 mountPath；返回 `{ branchId, accessToken, expiresAt? }`。Worker 请求用 accessToken 作 Bearer。
- **mcpRequest(token, method, params?)**：POST `/api/mcp`，Bearer token，body 为 JSON-RPC 2.0；返回 `Promise<Response>`，用例里对 result/error 和 content 断言。
- 每个 it/describe 用 `realmId = 'e2e-' + crypto.randomUUID()` 隔离。

## 5. 错误处理与 CI

- **失败时**：`startTestServer()` 失败则抛错；单个 it 失败不重启 server；整次 run 结束时在最外层 `afterAll` 调用一次 `stop()`。
- **CI**：`apps/server-next` 下 `"test:e2e": "bun test e2e/"`，`"test": "bun run test:unit && bun run test:e2e"`；CI 执行 `bun run test:e2e` 或从根 `cd apps/server-next && bun run test:e2e`；不启 Docker；env 在 setup 写死或 CI 注入同一套。
- **根目录**：若根已有 test 脚本包含 server-next，可在根 `test:e2e` 中增加 `cd apps/server-next && bun run test:e2e`，或按现有约定保留各 app 自管 e2e。
- **超时**：默认用 Bun 默认超时；若单 it 需更长可单独设 timeout。

---

**下一步**：使用 writing-plans 技能生成具体实现计划（Task/Step 与文件清单）。
