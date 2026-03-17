# drive API polish 工作文档

## #1 current API design (routes only)

> 范围：仅列出当前已注册 routes 与路径入口，不展开 input/output/auth 细节。

### 1.1 Main app 显式注册 routes（`cells/drive/backend/app.ts`）

| Method | Path | Route owner | Condition / notes |
|---|---|---|---|
| GET | `/api/health` | app inline handler | Always enabled |
| GET | `/api/info` | app inline handler | Always enabled |
| GET | `/api/me` | `controllers/me.ts` | Always enabled |
| GET | `/api/me/settings` | `controllers/me.ts` | Always enabled |
| PATCH | `/api/me/settings` | `controllers/me.ts` | Always enabled |
| GET | `/api/realm/:realmId/files` | `controllers/files.ts` | `meta=1` -> stat, else list |
| GET | `/api/realm/:realmId/files/:path{.+}` | `controllers/files.ts` | `meta=1` -> stat, else file/directory read |
| PUT | `/api/realm/:realmId/root` | `controllers/files.ts` | set root as file |
| PUT | `/api/realm/:realmId/files/:path{.+}` | `controllers/files.ts` | upload file |
| POST | `/api/realm/:realmId/fs/mkdir` | `controllers/fs.ts` | Always enabled |
| POST | `/api/realm/:realmId/fs/rm` | `controllers/fs.ts` | Always enabled |
| POST | `/api/realm/:realmId/fs/mv` | `controllers/fs.ts` | Always enabled |
| POST | `/api/realm/:realmId/fs/cp` | `controllers/fs.ts` | Always enabled |
| POST | `/api/realm/:realmId/branches` | `controllers/branches.ts` | create branch |
| GET | `/api/realm/:realmId/branches` | `controllers/branches.ts` | list branches |
| POST | `/api/realm/:realmId/branches/:branchId/revoke` | `controllers/branches.ts` | revoke branch |
| POST | `/api/realm/:realmId/branches/:branchId/close` | `controllers/branches.ts` | close branch |
| POST | `/api/realm/:realmId/branches/:branchId/transfer-paths` | `controllers/branches.ts` | transfer paths |
| GET | `/api/realm/:realmId/delegates` | `controllers/delegates.ts` | list delegates |
| POST | `/api/realm/:realmId/delegates` | `controllers/delegates.ts` | create delegate |
| POST | `/api/realm/:realmId/delegates/:delegateId/revoke` | `controllers/delegates.ts` | revoke delegate |
| GET | `/api/realm/:realmId` | `controllers/realm.ts` | realm info |
| GET | `/api/realm/:realmId/usage` | `controllers/realm.ts` | realm usage |
| POST | `/api/realm/:realmId/gc` | `controllers/realm.ts` | gc trigger |
| GET | `/mcp` | app inline handler | returns method-not-allowed JSON |
| GET | `/mcp/` | app inline handler | returns method-not-allowed JSON |
| POST | `/mcp` | `mcp/cell-mcp-route.ts` | JSON-RPC endpoint |
| POST | `/mcp/*` | `mcp/cell-mcp-route.ts` | JSON-RPC endpoint (subpath tolerant) |
| ALL | `/mcp/*` | app inline handler | fallback 404 JSON |

### 1.2 Mounted local route modules（通过 `app.route("/", ...)`）

#### A) `controllers/login-redirect.ts`

| Method | Path | Condition / notes |
|---|---|---|
| GET | `/api/oauth/login` | Only when `ssoBaseUrl` configured |
| GET | `/api/oauth/logout` | Only when `ssoBaseUrl` configured |
| GET | `/api/oauth/authorize` | Only when `ssoBaseUrl` configured |
| GET | `/.well-known/oauth-authorization-server` | Only when `ssoBaseUrl` configured |
| GET | `/.well-known/oauth-protected-resource` | Only when `ssoBaseUrl` configured |
| POST | `/api/oauth/register` | Only when `ssoBaseUrl` configured |
| GET | `/api/oauth/client-info` | Only when `ssoBaseUrl` configured |
| DELETE | `/api/oauth/client-info` | Only when `ssoBaseUrl` configured |

#### B) `controllers/csrf.ts`

| Method | Path | Condition / notes |
|---|---|---|
| GET | `/api/csrf` | Always registered; behavior differs by `ssoBaseUrl` |

### 1.3 Mounted external package routes（通过 `app.route("/", ...)`）

#### A) `@casfa/cell-delegates-server` -> `createDelegateOAuthRoutes(...)`

Source: `packages/cell-delegates-server/src/delegate-oauth-routes.ts`

| Method | Path | Condition / notes |
|---|---|---|
| POST | `/api/oauth/delegate/authorize` | Always mounted in drive app |
| POST | `/api/oauth/token` | Always mounted in drive app |

### 1.4 Middleware-provided public path entry（非显式 route）

Source: `middleware/branch-url-auth.ts`

| Method | Path pattern | Notes |
|---|---|---|
| ANY | `/branch/:branchId/:verification/...` | Middleware validates and rewrites to normalized internal path, then re-dispatches to app |
| ANY | `/<mount>/branch/:branchId/:verification/...` | Same behavior; supports mount prefix before `branch` |

---

## #2 routes review (issues + suggestions + decisions)

### 2.1 Decision log（已确认）

| # | Topic | Current | Decision |
|---|---|---|---|
| 1 | `dev/mock-token` | `GET/POST /api/dev/mock-token`（仅 mock auth 时注册） | 若确认无调用方则移除 |
| 2 | Branch lifecycle endpoint naming | route 为 `.../branches/:branchId/close`，历史文档/测试仍有 `complete` 语义残留 | 统一使用 `close`，不再保留 “complete=merge+close” 语义 |
| 3 | MCP base path | 已使用 `/mcp`（含 `/mcp/*`） | 维持 `/mcp` 作为 canonical 路径 |
| 4 | OAuth path prefix | 目前混用 `/oauth/*` 与 `/api/oauth/*` | 统一收敛到 `/api/oauth/*` |
| 5 | Delegates route scope | 当前是全局 `/api/delegates*` | 下沉到 realm 作用域（`/api/realm/:realmId/delegates*`） |

### 2.2 Route-level findings and rationale

#### A) `dev/mock-token` 是否可删

- 代码调用检索结果：仅在 `cells/drive/backend/app.ts` 与 `controllers/dev-mock-token.ts` 出现。
- 在 `cells/drive` 前端、E2E、其他 cells 中未发现调用。
- 结论：从仓库内证据看可删；若团队依赖“手工本地调试拿 token”，需补一个替代方案（例如测试 helper 或脚本）。

#### B) `close` 命名统一

- 当前主路由已是 `.../close`，但测试与文档仍残留 `.../complete` 术语。
- 继续同时保留会造成调用方心智负担和维护成本。
- 结论：统一为 `close`，并清理 `complete` 术语与路径残留。

#### C) OAuth 统一到 `/api/oauth/*` 对 MCP 的影响

- MCP OAuth 发现主要依赖 `/.well-known/oauth-authorization-server` 返回的 `authorization_endpoint`、`token_endpoint`、`registration_endpoint`。
- 因此路径可迁移，但必须同步更新：
  - `/.well-known/*` 返回值
  - 前端硬编码 `/oauth/*` 路径（登录、token、client-info）
  - `cell.yaml` 路由白名单
  - 相关测试基线
- 结论：可迁移，不会破坏 MCP 机制本身；但会影响当前 path 假设，需兼容期或一次性改全链路。

#### D) Delegates 下沉 realm 作用域

- 现状 delegates 与 files/branches 不同层级，风格不一致。
- 下沉后能与 realm 作用域模型对齐（鉴权和路径语义更一致）。
- 结论：迁移到 `/api/realm/:realmId/delegates*`，并评估是否保留旧路由 alias。

### 2.3 Next discussion items（进入 #3 前待确认）

- 兼容策略已确认：不提供 alias，按新路径直接切换。
- `dev/mock-token` 已确认直接删除，不保留 deprecate 过渡期。

---

## #3 route contract review (input/output/auth)

### 3.1 Global auth / realm middleware（第一批）

#### 3.1.1 `createAuthMiddleware`（`middleware/auth.ts`）

- Input：无显式参数；依赖上游已经写入 `c.get("auth")`。
- Auth：无 auth -> `401 UNAUTHORIZED`。
- Output：错误体 `{ error, message }`。
- 评估：`合理`（语义明确，状态码正确）。

#### 3.1.2 `createRealmMiddleware`（`middleware/realm.ts`）

- Input：`routes param realmId`，支持 `me`。
- Auth：要求已有 auth；realmId 必须与 auth 有效 realm 一致。
- Output：错误体 `{ error, message }`，状态码用 403。
- 评估：`建议修改`
  - 建议 1：`!auth` 时改为 `401`（当前是 403），与 auth middleware 语义对齐。
  - 建议 2：若该 middleware 仅用于已挂 auth 的路由，保留 403 也可，但需文档明确“这是防御分支，理论不可达”。

### 3.2 Files routes（`controllers/files.ts`，第一批）

#### 3.2.1 GET list/stat/getOrList

- Input 来源：
  - path param: `:path{.+}`（可空根路径）
  - query: `meta=1`（在 app 层分发 list/stat）
- Auth：
  - 统一检查 `hasFileRead`（user 全量、delegate 需 `file_read`、worker 读/写均可读）
- Output：
  - list: `{ entries: [{ name, kind, size? }] }`
  - stat: `{ kind, size?, contentType? }`
  - get file: raw body + `Content-Type` / `Content-Length`
- 评估：`部分合理 + 建议修改`
  - 合理：读权限模型清晰；目录和文件行为边界明确。
  - 建议 1：`meta=1` 分流可读性一般，建议长期拆成显式 stat 路径（例如 `/api/realm/:realmId/fs/stat` 或 `HEAD`）。
  - 建议 2：root 修复逻辑（user root 丢失时自动 repair）在 list/stat/getOrList 三处重复，建议下沉为共享 helper。

#### 3.2.2 PUT upload / PUT root

- Input 来源：
  - path param + raw body（二进制）
  - header `Content-Type`
- Auth：
  - `hasFileWrite`；`setRootAsFile` 额外要求 `worker`
- Output：
  - success：`201` + `{ path, key }`
  - oversize/path invalid：`400`
- 评估：`建议修改`
  - 建议 1：`{ path, key }` 暴露内部 CAS key，若前端/调用方不需要，建议去除或迁移到 debug-only 字段。
  - 建议 2：`MAX_BODY` 在多个控制器重复定义，建议提取常量。

### 3.3 FS mutation routes（`controllers/fs.ts`，第一批）

#### 3.3.1 mkdir/rm/mv/cp

- Input 来源：
  - body JSON：`path` / `paths` / `from` / `to`
  - 路由统一 `POST /api/realm/:realmId/fs/*`
- Auth：
  - 统一 `hasFileWrite`
- Output：
  - mkdir: `201 { path }`
  - rm: `200 { removed }`
  - mv: `200 { from, to }`
  - cp: `201 { from, to }`
- 评估：`建议修改`
  - 建议 1：`cp` 用 `201`，`mv` 用 `200`，语义上可解释但风格不统一；建议明确一条规则并文档化（推荐：都 `200`）。
  - 建议 2：`rm` 对无效 path 会被 quietly skip（`if (!pathStr) continue`），建议改为 fail-fast，避免 silent success。
  - 建议 3：`parseBodyJson` 解析失败返回 `{}`，后续再报 `path required`，错误定位不够直接；建议 JSON parse 失败直接 `400 Invalid JSON body`。

### 3.4 本批待你确认

已确认：

1. `realm middleware` 的 `!auth` 分支改为 `401`。
2. `files upload` 成功响应保留 `key`。
3. `fs_cp` 统一改为 `200`（与 `mv` 对齐）。
4. `fs.rm` 遇到空 path 改为直接报错（不再 silent skip）。
5. JSON parse 错误统一返回 `400 Invalid JSON body`。

### 3.5 Branch routes（`controllers/branches.ts`，第二批）

#### 3.5.1 POST `/api/realm/:realmId/branches`（create）

- Input 来源：
  - body: `mountPath`, `ttl?`, `parentBranchId?`, `initialTransfers?`
- Auth：
  - 有 `parentBranchId`：仅 worker 且必须是该 parent branch
  - 无 `parentBranchId`：user 或 delegate(`branch_manage`)
- Output：
  - `201` + `{ branchId, accessToken, expiresAt, accessUrlPrefix? }`
- 评估：`建议修改`
  - 建议 1：`ttl` 单位未在实现注释中显式强调（实际按 ms），建议在 API 文档与校验错误中明确单位。
  - 建议 2：`initialTransfers` 当前仅校验不执行，建议在响应中显式返回 `initialTransfersValidated: true`（或移除此输入，避免误解“已执行”）。

#### 3.5.2 GET `/api/realm/:realmId/branches`（list）

- Input 来源：path `realmId`
- Auth：
  - user/delegate 列出 realm 全部分支
  - worker 仅返回自身分支
- Output：`200 { branches: [{ branchId, parentId, expiresAt }] }`
- 评估：`合理`

#### 3.5.3 POST revoke/close/transfer-paths

- revoke: `POST /branches/:branchId/revoke`
- close: `POST /branches/:branchId/close`
- transfer-paths: `POST /branches/:branchId/transfer-paths` + body `TransferSpec`
- Auth：
  - revoke: user/delegate(`branch_manage`)
  - close: worker 可关闭自身；user/delegate 可关闭 realm 内 branch
  - transfer-paths: worker 仅允许 self->self；user/delegate(`branch_manage`) 可执行
- Output：
  - revoke: `200 { revoked: branchId }`
  - close: `200 { closed: branchId }`
  - transfer-paths: `200 { ...result }`
- 评估：`建议修改`
  - 建议 1：revoke not found 返回 `404`，close not found 返回 `200`（幂等）——同属“终结”动作但语义不一致。建议统一风格（推荐都幂等 200）。
  - 建议 2：worker `close` 支持 `:branchId = "me"`，但 route 层并未声明别名文档，建议写入 contract 并在测试统一使用 `close` 路径。

### 3.6 Realm / Me routes（第二批）

#### 3.6.1 GET `/api/realm/:realmId` / `/usage` / POST `/gc`

- Input 来源：
  - path `realmId`
  - `gc` body: `cutOffTime?`
- Auth：
  - user/delegate 可访问
- Output：
  - info: `{ realmId, lastGcTime, nodeCount, totalBytes, branchCount, delegateCount }`
  - usage: `{ nodeCount, totalBytes }`
  - gc: `{ gc: true, cutOffTime }`
- 评估：`建议修改`
  - 建议：`gc` body parse 失败目前退化为空对象并使用默认值，建议改为 `400 Invalid JSON body`，与全局 parse 策略统一。

#### 3.6.2 GET `/api/me` / settings

- Input 来源：
  - `PATCH /api/me/settings` body: `{ language?, notifications? }`（白名单过滤）
- Auth：
  - 仅 user
- Output：
  - profile/settings JSON
- 评估：`合理`

### 3.7 OAuth routes（`controllers/login-redirect.ts` + delegates oauth routes，第二批）

#### 3.7.1 Login redirect routes

- Input 来源：
  - query: `return_url`, `client_id`
- Auth：
  - `/oauth/login`（待迁移到 `/api/oauth/login`）在“已登录”与“未登录”分支行为不同
- Output：
  - 主要为 `302 redirect`
  - register/client-info 为 JSON
- 评估：`建议修改`
  - 建议 1：迁移到 `/api/oauth/*` 后，前端 route `/oauth/login`（页面路由）与 backend `/api/oauth/login`（API 路由）需严格区分，避免名称冲突。
  - 建议 2：`/api/oauth/logout` 目前是 redirect 行为，建议在文档中标记“非纯 API（副作用 + 跳转）”。

#### 3.7.2 Delegate OAuth routes（external package）

- Input 来源：
  - `POST /api/oauth/delegate/authorize` JSON body
  - `POST /oauth/token` form-urlencoded（待迁移 `/api/oauth/token`）
- Auth：
  - authorize 需要登录用户身份
  - token 端点不要求上游 auth（按 oauth code/refresh 流程）
- Output：
  - authorize: `{ redirect_url }`
  - token: OAuth token payload（snake_case）
- 评估：`建议修改`
  - 建议：迁移 `/oauth/token` -> `/api/oauth/token` 时，同步更新 `/.well-known/oauth-authorization-server` 的 `token_endpoint` 与 `registration_endpoint`，保证 MCP/OAuth client discovery 不断裂。

### 3.8 MCP routes（第二批）

#### 3.8.1 GET/POST `/mcp` and `/mcp/*`

- Input 来源：
  - JSON-RPC body（POST）
  - `Accept`（GET 时用于返回提示文案）
- Auth：
  - 统一要求 auth middleware
- Output：
  - GET: `405` JSON（提示仅支持 POST JSON-RPC）
  - POST: MCP JSON-RPC response
  - fallback: `404` JSON
- 评估：`建议修改`
  - 建议 1：`mcp/cell-mcp-route.ts` 中未授权错误体当前为 `{ error: "Unauthorized" }`，建议统一为 `{ error, message }`。
  - 建议 2：`POST /mcp/*` 自动规范化到 `/mcp` 是兼容技巧，建议在文档明确“子路径被接受但并非独立资源”。

### 3.9 第二批确认结果

1. `branches/revoke` 与 `branches/close` 的 not-found 语义统一为幂等 `200`。
2. `realm.gc` JSON parse 失败改为 `400 Invalid JSON body`。
3. OAuth 强制只保留 `/api/oauth/*`（token/register/client-info/login/logout）。
4. MCP 未授权错误体统一为 `{ error, message }`。

---

## #4 compatibility & execution plan

### 4.1 Compatibility policy（已确认）

- 不保留兼容 alias，不做双路由并行期：
  - `/oauth/*` -> `/api/oauth/*`（直接切换）
  - `/api/delegates*` -> `/api/realm/:realmId/delegates*`（直接切换）
- `GET/POST /api/dev/mock-token` 直接删除，不提供过渡版本。

### 4.2 Planned API changes

| Change | Before | After |
|---|---|---|
| Remove mock token route | `/api/dev/mock-token` | removed |
| OAuth path normalization | `/oauth/login` `/oauth/logout` `/oauth/register` `/oauth/token` `/oauth/client-info` | `/api/oauth/login` `/api/oauth/logout` `/api/oauth/register` `/api/oauth/token` `/api/oauth/client-info` |
| Branch lifecycle path term | 历史残留 `complete` 语义/路径 | 统一 `close` |
| Delegates scope | `/api/delegates*` | `/api/realm/:realmId/delegates*` |

### 4.3 Impacted callers

- `cells/drive/frontend`：登录跳转、oauth callback token exchange、client-info 查询、delegates store API。
- `cells/drive/tests`：OAuth、delegates、branches 相关 E2E 路径与断言。
- `cells/drive/cell.yaml`：backend routes 白名单需同步为 `/api/oauth/*`。
- 依赖 `/.well-known/oauth-authorization-server` 的 MCP/OAuth 客户端：会跟随 metadata 新 endpoint；若有硬编码 `/oauth/*` 的外部调用方会直接中断。

### 4.4 Execution order（high level）

1. 路由重命名与挂载收敛（oauth、delegates、mock-token 删除、close 术语统一）。
2. 前端调用路径同步。
3. 测试基线同步（unit/e2e）。
4. 文档更新（README + API 文档 + 计划文档）。
5. 全量验证（drive 单测 + e2e + 关键跨 cell 联调检查）。

### 4.5 Round 2 execution log (2026-03-17)

本轮按 TDD 执行（先补测试再改实现）：

- 新增/调整测试（Red）：
  - `backend/controllers/login-redirect.test.ts`：`/api/oauth/client-info` 错误体断言（要求 `{ error, message }`）。
  - `backend/controllers/csrf.test.ts`：`/api/csrf`（SSO 未配置）错误体断言。
  - `tests/oauth-routes.test.ts`：e2e 校验 `/api/oauth/client-info` 缺参错误体。
- 实现修复（Green）：
  - `controllers/csrf.ts`：未配置 SSO 时返回 `{ error: "SSO_NOT_CONFIGURED", message }`。
  - `controllers/login-redirect.ts`：`/api/oauth/client-info` GET/DELETE 缺参与未找到场景统一 ErrorBody。
  - `frontend/App.tsx`：`DelegateOAuthConsentPage` 的 `clientInfoUrl` 改为 `withMountPath("/api")`，修复错误拼接为 `/api/oauth/oauth/client-info` 的问题。
- 验证结果：
  - `bun run test:unit` 通过。
  - `bun run test:e2e` 通过（82 pass, 0 fail）。

