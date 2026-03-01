# CASFA server-next API 设计

**日期**：2026-03-01  
**状态**：规划中  
**依据**：[2026-03-01-requirements-use-cases.md](./2026-03-01-requirements-use-cases.md)  
**鉴权与类型形态**：[2026-03-01-server-next-module-design.md](./2026-03-01-server-next-module-design.md)（AuthContext 为 discriminated union，User 无 realmId/permissions，Worker 为 access: readonly|readwrite）。

本文档定义 server-next 的 REST API 形态、鉴权模型与端点规划，供实现使用。不涉及具体实现步骤（实现计划另文档产出）。

---

## 1. 设计原则

- **路径型 REST**：文件与资源以路径标识，API 与用例中的「路径」一致。
- **统一鉴权**：所有需要认证的请求均使用 `Authorization: Bearer <token>`；服务端根据 token 类型解析为 User / Delegate / Worker（具体上下文形态见 [module-design](./2026-03-01-server-next-module-design.md) §2）。
- **Realm 即用户空间**：`realmId = userId`；User 的「有效 realmId」由 userId 推导（当前 1:1）；Delegate/Worker 的 realmId 在上下文中。User 仅访问自己的 realm（`/api/realm/me` 或由 token 解析出 userId 后作为 realmId）。
- **User / Delegate 共用一套文件与 Branch 端点**：差异由权限与「是否允许 Delegate 管理」等配置决定；Worker 使用同一套文件/Branch 端点，但作用域为当前 Branch。

---

## 2. 鉴权模型

### 2.1 Token 类型与识别

| Token 类型 | 识别方式 | 解析结果 | 说明 |
|------------|----------|----------|------|
| **OAuth Access Token** | JWT 或 OAuth 标准 opaque token；可通过 introspect 或 JWT 解析得到 `sub`（userId）及可选 `client_id` | **User**：sub = userId → realmId = userId，视为 root 作用域，全权限。<br>**Delegate**：同一 token 若关联到某 Delegate 授权记录（client_id + realmId）→ 视为该 Delegate，权限可配置。 | User 与 Delegate 的区分：若 token 仅含 userId（如用户登录后拿到的 AT）→ User；若 token 为「Delegate 授权」签发（OAuth 授权码流程或用户主动分配）→ Delegate。 |
| **Branch Token** | 约定格式（如二进制或 base64 编码），内含 branchId 或可查表得到 branchId | 查 Branch 存储 → 得到 branchId、realmId、parent、mountPath、当前 root；作用域为该 Branch。 | Worker 持有；TTL 与 complete 后失效。 |

实现时需约定：  
- OAuth AT 的「User vs Delegate」判定：例如 JWT 的 `aud`/`client_id` 或 DB 中「该 token 是否绑定到某 Delegate 授权」；  
- Branch Token 的编码与存储（branchId、hash 校验、过期时间）。

### 2.2 请求上下文

认证中间件输出统一上下文，供路由与业务使用。**类型形态为 discriminated union**，详见 [2026-03-01-server-next-module-design.md](./2026-03-01-server-next-module-design.md) §2：

- **User**：`type: "user"`，仅 `userId`；realmId 由 userId 查询（当前 1:1）；天然拥有该 realm 全部权限。
- **Delegate**：`type: "delegate"`，`realmId`、`delegateId`、`clientId`、`permissions`（细粒度配置）。
- **Worker**：`type: "worker"`，`realmId`、`branchId`、`access: "readonly"|"readwrite"`；操作范围固定为读/写文件、创建子 Branch、complete。

「当前根」解析：User 与 Delegate 使用 Realm 的当前根（root branch 持有的 node key）；Worker 使用该 Branch 的当前根。

---

## 3. 基础路径与版本

- **Base path**：`/api`（或按部署需要加前缀，如 `/api/v1`，本文以 `/api` 为例）。
- **Realm 作用域**：所有与「某用户空间」相关的接口均落在 `/api/realm/:realmId` 下；`:realmId` 对 User 即 userId，可用字面量 `me` 表示「当前 token 的 userId」以简化前端（服务端将 `me` 解析为 auth.userId）。
- **健康与元数据**：`/api/health`、`/api/info` 等无需 realm 的放在 `/api` 下。

---

## 4. 端点规划（按用例映射）

### 4.1 健康与发现

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 无 | 健康检查 |
| GET | `/api/info` | 无 | 服务元信息（存储类型、认证类型等，可选） |

### 4.2 OAuth / 认证（与现有能力对齐）

以下与现有 server 的 OAuth 能力对齐，供 User 登录与 Delegate 授权使用。

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/.well-known/oauth-authorization-server` | 无 | OAuth 授权服务器元数据（RFC 8414） |
| GET | `/.well-known/oauth-protected-resource` | 无 | 保护资源元数据（RFC 9728，MCP 等发现） |
| GET | `/api/auth/authorize/info` | 无 | 授权页所需参数校验与展示信息 |
| POST | `/api/auth/authorize` | User (JWT/AT) | 用户批准授权（Delegate OAuth 流程） |
| POST | `/api/auth/token` | 无 | OAuth token 端点（authorization_code, refresh_token） |
| POST | `/api/auth/register` | 无 | 动态客户端注册（RFC 7591，可选） |
| POST | `/api/auth/refresh` | Delegate (refresh_token) | Refresh token 换新 access（及可选 refresh） |

说明：User 登录（如 Cognito 或本地登录）若走现有 OAuth 端点，则 User 的 AT 即「OAuth Access Token」；Delegate 通过授权码或用户分配得到的 token 也通过同一套端点签发，仅语义与权限不同。

### 4.3 Realm 作用域下的统一前缀

以下所有端点均在 **Realm 作用域** 内，即：  
- 路径形式为 `/api/realm/:realmId/...` 或 `/api/realm/me/...`（`me` → 当前 User 的 userId 作为 realmId，或 Delegate/Worker 的 auth.realmId）。  
- 认证要求：User、Delegate 或 Worker（Branch token）；且 **请求的 :realmId 必须与「有效 realmId」一致**（User 时有效 realmId = userId，Delegate/Worker 时 = auth.realmId）。

---

### 4.4 文件访问（U-F1～U-F7 / D-F1～D-F7 / W-F1～W-F5）

路径约定：**路径参数使用 URL 编码的 path**；根为 `""` 或 `"/"`，子路径如 `"/foo"`、`"/foo/bar"`。以下以 `{path}` 表示「路径」，实际 URL 可为 `path=/foo/bar` 或 path 作为路径段（需约定是否用 proxy 如 `/files/foo/bar`），此处采用 **query 或 path 段** 两种常见方式之一，设计时二选一并在文档中固定。

建议：**路径放在 path 段**，例如 `/api/realm/:realmId/files/*path`，其中 `*path` 为 0 或多个 path 段（如 `files/foo/bar` 表示 path=`/foo/bar`）；根目录为 `files` 或 `files/`。以下按此约定列出。

| 方法 | 路径 | 认证 | 用例 | 说明 |
|------|------|------|------|------|
| GET | `/api/realm/:realmId/files` 或 `.../files/*path` | User / Delegate / Worker | U-F1, D-F1, W-F1 | 列出 path 下条目（文件名、大小等）；Worker 时 path 相对于 Branch 根。 |
| GET | `/api/realm/:realmId/files/*path`（表示下载） | User / Delegate / Worker | U-F2, D-F2, W-F2 | 下载该路径对应文件。**首版**：仅支持单 node 文件（约 4MB），响应为完整 body。 |
| PUT | `/api/realm/:realmId/files/*path` | User / Delegate / Worker（需写权限） | U-F3, D-F3, W-F3 | 上传文件。**首版**：body 为整文件，仅支持单 node 可存大小（约 4MB，即单 node 上限；文件内容刨除 header 后接近 4MB）；服务端写入 f-node 并更新路径后 commit。 |
| HEAD 或 GET | `/api/realm/:realmId/files/*path?meta=1` 或单独 stat 端点 | User / Delegate / Worker | U-F4, D-F4, W-F4 | 文件/目录元数据（大小、类型等）。 |
| POST | `/api/realm/:realmId/fs/mkdir`（body: path） | User / Delegate / Worker（写） | U-F5, D-F5, W-F5 | 创建目录。 |
| POST | `/api/realm/:realmId/fs/mv`（body: from, to） | 同上 | U-F5, D-F5, W-F5 | 移动。 |
| POST | `/api/realm/:realmId/fs/cp`（body: from, to） | 同上 | U-F5, D-F5, W-F5 | 复制。 |
| POST | `/api/realm/:realmId/fs/rm`（body: path 或 paths） | 同上 | U-F5, D-F5, W-F5 | 删除。 |
| GET | `/api/realm/:realmId/usage` | User / Delegate | U-F6, D-F6 | 空间用量（node 数、总字节等）。 |
| POST | `/api/realm/:realmId/gc`（body: cutOffTime 等） | User / Delegate | U-F7, D-F7 | 触发 GC。 |

说明：  
- Worker 访问上述文件端点时，`:realmId` 为其 Branch 所属 realm，服务端用 **Worker 的 branchId** 对应当前根解析 path。  
- **首版不提供** nodes/check、nodes/raw、commit、manifest 等分块上传/下载端点；大文件设计见 [2026-03-01-file-chunk-upload-download.md](./2026-03-01-file-chunk-upload-download.md)（后续实现）。

### 4.5 Branch 管理（U-B1～U-B3, D-B1～D-B3, W-B1, W-C1）

| 方法 | 路径 | 认证 | 用例 | 说明 |
|------|------|------|------|------|
| POST | `/api/realm/:realmId/branches` | User / Delegate | U-B1, D-B1 | 创建 Branch。Body：`mountPath`, `ttl`（ms）；返回 `branchId`, `accessToken`（Branch token）, `expiresAt`。Parent 为 realm 当前根。 |
| GET | `/api/realm/:realmId/branches` | User / Delegate | U-B3, D-B3 | 列出 Branch；Worker 不可用或仅可见自身（由权限决定）。 |
| GET | `/api/realm/:realmId/branches/:branchId` | User / Delegate | — | 单个 Branch 详情（可选）。 |
| POST | `/api/realm/:realmId/branches/:branchId/revoke` | User / Delegate | U-B2, D-B2 | 撤销 Branch，使其 token 失效。 |
| POST | `/api/realm/:realmId/branches`（Body 含 parentBranchId） | Worker | W-B1 | 在当前 Branch 下创建子 Branch。Body：`mountPath`, `ttl`；parent = 当前 auth.branchId；返回 `branchId`, `accessToken`, `expiresAt`。 |
| POST | `/api/realm/:realmId/branches/me/complete` 或 `.../branches/:branchId/complete` | Worker | W-C1 | 完成当前 Branch：合并回 parent，Branch 失效。若用 `me` 表示当前 token 的 Branch。 |

说明：  
- 创建子 Branch 的端点可与「在 root 下创建 Branch」共用 `POST .../branches`，通过 body 是否含 `parentBranchId` 区分：无则 parent=realm root（仅 User/Delegate）；有则 parent=parentBranchId（且调用方必须是该 parent 的 Worker 或 realm 的 User/Delegate）。  
- 或拆成两条路径，如 `POST .../branches`（root 下创建）与 `POST .../branches/me/children`（Worker 当前 Branch 下创建），依实现偏好选定。

### 4.6 Delegate 授权管理（U-D1～U-D3）

仅 User（或配置了 delegate_manage 的主体）可访问。

| 方法 | 路径 | 认证 | 用例 | 说明 |
|------|------|------|------|------|
| GET | `/api/realm/:realmId/delegates` | User | U-D1 | 列出已授权的 Delegate（client_id、创建时间、权限摘要等）。 |
| POST | `/api/realm/:realmId/delegates/:delegateId/revoke` | User | U-D2 | 撤销某 Delegate，其 token 失效。 |
| POST | `/api/realm/:realmId/delegates/assign` | User | U-D3（用户主动分配） | 为用户分配的 token 创建授权。Body：`ttl`（可选）、`client_id`（可选，缺省时由服务端生成；DelegateAuth 中 clientId 必填，见 module-design）；返回 `accessToken`（及可选 refreshToken、expiresAt），用户复制给客户端使用。 |

Delegate 通过 OAuth 授权码流程的「增加授权」由 `POST /api/auth/authorize` + `POST /api/auth/token` 完成，不在此表重复。

### 4.7 Realm 信息

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/realm/:realmId` | User / Delegate | Realm 摘要信息（可与 usage 合并或分开）。 |

---

## 5. MCP 集成

- **MCP 入口**：`POST /api/mcp`（与现有一致）。  
- **认证**：要求 Bearer token；可为 Delegate 的 OAuth AT 或 Worker 的 Branch token。  
- **语义**：MCP 请求在认证后得到 auth 上下文（realmId、scope=root 或 branch）；MCP handler 内部可调用「文件列表、下载、上传、创建 Branch、complete」等能力时，复用同一套 realm 与 branch 解析逻辑，无需单独定义 MCP 专属 REST 路径。

---

## 6. 请求/响应约定（概要）

- **Content-Type**：JSON 请求 `application/json`；文件上传可为 `application/octet-stream` 或 multipart；下载为 `application/octet-stream` 或具体 MIME。  
- **错误**：HTTP 状态码 + 统一错误体，如 `{ "error": "code", "message": "..." }`；401/403 表示未认证/无权限。  
- **路径编码**：path 中若有特殊字符，按 URL 编码；服务端对 path 做规范化（如去多余 `/`、禁止 `..`）。  
- **首版文件**：单 node 文件（约 4MB，单 node 上限；文件内容刨除 header 后接近 4MB）；上传/下载均为单次请求 body。大文件与流式、Range 见 [2026-03-01-file-chunk-upload-download.md](./2026-03-01-file-chunk-upload-download.md)（后续实现）。

---

## 7. 与需求文档的对应关系

| 需求章节 | 本设计对应 |
|----------|------------|
| 3.1 User 文件访问 U-F1～U-F7 | §4.4 文件访问 |
| 3.1 User Branch 管理 U-B1～U-B3 | §4.5 Branch 管理（root 下创建、列表、撤销） |
| 3.1 User Delegate 管理 U-D1～U-D3 | §4.6 Delegate 授权管理 + §4.2 OAuth |
| 3.2 Delegate 文件与 Branch | 同 §4.4、§4.5；权限由 auth.permissions 控制（见 module-design） |
| 3.3 Worker 文件、子 Branch、complete | §4.4（Branch 当前根）、§4.5（子 Branch 创建、complete）；auth.access 控制只读/读写 |

---

## 8. 后续步骤

- 确定「path 在 URL 中的具体形式」（path 段 vs query）与 path 编码规范。  
- 实现鉴权中间件（OAuth AT 解析、Branch token 解析、User vs Delegate 判定；AuthContext 形态见 [module-design](./2026-03-01-server-next-module-design.md)）。  
- 产出逐端点的请求/响应 schema（如 JSON Schema 或 OpenAPI 片段）与实现计划文档。  
- **首版**：不实现分块与 nodes 端点；文件为单 node（约 4MB）。**大文件分块**：详见 [2026-03-01-file-chunk-upload-download.md](./2026-03-01-file-chunk-upload-download.md)，供后续扩展。


