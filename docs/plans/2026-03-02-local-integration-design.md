# server-next 本地前后端联调方案设计（方案 3）

## 目标

在 server-next 内实现**一条命令**同时启动 API（7101）与前端（7100），支持两种鉴权方式：**默认 dev 用 mock**（后端提供 mock-token 接口），**另提供 dev:cognito 用 Cognito**；前端统一通过「先 /api/me 拿 realmId，再调 /api/realm/:realmId/files」对接后端，并将后端返回的 `entries` 映射为现有 FsEntry 类型。

## 与工程框架的关系

- 本方案在 [2026-03-02-casfa-next-engineering-design.md](./2026-03-02-casfa-next-engineering-design.md) 的「环境与端口」「鉴权约定」基础上细化**本地开发**的启动方式与 API 对接。
- 工程设计中 local-dev 原为 Cognito、local-test 为 mock；本方案采纳「默认 dev 用 mock、dev:cognito 用 Cognito」，**仅影响 local-dev 的 dev 脚本与前端鉴权分支**，local-test（dev:test / test:e2e）保持不变。

---

## 第一节：启动与端口

- **一条命令**：`bun run dev` 或 `bun run dev:cognito` 均在同一进程中（或通过 concurrently / 子进程）同时启动：
  - 后端：serverless-offline，HTTP 端口 **7101**
  - 前端：Vite dev server，端口 **7100**，proxy `/api` → `http://localhost:7101`
- **端口约定**：与工程设计一致，local-dev 使用 7100（前端）、7101（API）、7102（DynamoDB 等）。
- **实现方式**：在根目录 `package.json` 的 `dev` 脚本中，用 concurrently（或 Bun 子进程）并行执行「启动 serverless offline」与「启动 frontend dev」（如 `bun run --cwd frontend dev`）；新增 `dev:cognito` 脚本，与 `dev` 相同启动方式，仅通过环境变量区分鉴权（见下节）。
- **dev:test 不变**：`bun run dev:test` 仍仅启动 API（7111），供 E2E 使用；不要求同一条命令启动前端。

---

## 第二节：鉴权与 mock-token

- **约定**：有 `MOCK_JWT_SECRET`（非空）即 mock 鉴权，无则 Cognito；不引入 `AUTH_MODE`。
- **`bun run dev`（默认）**：
  - 启动时设置 `MOCK_JWT_SECRET`（如固定值 `dev-mock-secret` 或从 .env 读取），不设或空则视为未设置。
  - 后端在 mock 模式下提供 **GET 或 POST `/api/dev/mock-token`**（仅当 `MOCK_JWT_SECRET` 存在时注册路由）：返回一个由后端使用 `MOCK_JWT_SECRET` 签名的 JWT，payload 至少包含 `sub`（用作 userId/realmId），可含 `email`、`name` 等便于前端展示。
  - 后端 auth 中间件：当 `config.auth.mockJwtSecret` 存在时，对 Bearer 中的 JWT 使用同一 secret 做签名校验（例如用 jose）；不校验时不再接受任意未签名 payload，以保证 mock 与 Cognito 行为清晰分离。
- **`bun run dev:cognito`**：
  - 启动时**不设置** `MOCK_JWT_SECRET`（或显式置空），后端使用 Cognito 校验；不注册 `/api/dev/mock-token`。
  - 前端通过现有 Cognito 登录流程获取 Id Token，请求 API 时带 `Authorization: Bearer <id_token>`。
- **前端鉴权分支**：
  - 前端通过调用 **GET `/api/info`**（已有）得到 `authType: "mock" | "cognito"`。
  - 若为 mock：先请求 `/api/dev/mock-token` 取 token，存于内存或 sessionStorage，后续所有 `/api/*` 请求带 `Authorization: Bearer <token>`。
  - 若为 cognito：使用 Cognito 登录后带 Id Token 请求 API。
- **安全**：`/api/dev/mock-token` 仅在设置了 `MOCK_JWT_SECRET` 时存在；生产及 beta/prod 不设该变量，路由可不注册或返回 404。

---

## 第三节：前端 API 层与 FsEntry 映射

- **流程**：前端统一采用「先拿当前用户身份，再按 realm 访问文件」：
  1. 带鉴权请求 **GET `/api/me`**，从响应中取 `userId`（与 realmId 一致）。
  2. 列表：**GET `/api/realm/:realmId/files`** 或 **GET `/api/realm/:realmId/files/:path`**（path 为空时等价根目录），query 可选 `meta=1` 仅取元数据。
  3. 文件内容/下载：**GET `/api/realm/:realmId/files/:path`**，无 `meta=1` 时对文件返回 binary，对目录返回 list（与现有 backend 行为一致）。
- **后端返回格式**（已实现）：列表与 getOrList 返回 `{ entries: [ { name, kind: "file" | "directory", size? } ] }`。
- **前端映射**：将每条 `entry` 转为现有 `FsEntry` 类型：
  - `name` → `name`
  - 当前请求的 path 与 name 拼出完整 path（如 `path === ""` 则 `entry.path = "/" + name`，否则 `entry.path = path + "/" + name`，注意首尾斜线统一）
  - `kind === "directory"` → `isDirectory: true`，否则 `isDirectory: false`
  - `size` → `size`（可选）
- **移除**：前端不再请求不存在的 `/api/fs/entries`；在非 mock 数据源时关闭对 `useMock` 的依赖，统一走上述 API。

---

## 第四节：错误与未登录

- **401 Unauthorized**：未带 token 或 token 无效时，后端返回 `{ error: "UNAUTHORIZED", message: "..." }`。前端统一处理：未登录时跳转登录页（Cognito）或自动请求 mock-token 并重试一次（mock）；若仍 401，提示「请重新登录」或「无法获取 mock token」。
- **403 Forbidden**：无权限访问该 realm/文件时返回 403，前端提示无权限。
- **404 Not Found**：路径或 realm 不存在，前端提示未找到。
- **其他**：沿用 Hono 的 onError/notFound 统一 JSON 格式，前端可按 `error` 与 `message` 做通用错误展示。

---

## 第五节：实施范围小结

| 项           | 内容 |
|--------------|------|
| 根 package.json | 新增 concurrently（或等效）依赖；`dev` 同时起 API + 前端，并设 `MOCK_JWT_SECRET`；新增 `dev:cognito` 同命令但不设 mock secret。 |
| 后端         | 新增 `/api/dev/mock-token`（仅 mock 时注册）；auth 中间件在 mock 模式下用 `MOCK_JWT_SECRET` 校验 JWT。 |
| 前端         | 调用 `/api/info` 区分 mock/cognito；mock 时先取 mock-token 再请求 /api/me 与 files；适配 /api/realm/:realmId/files 并做 entries → FsEntry 映射；移除对 /api/fs/entries 的依赖。 |
| 文档         | 工程设计文档可增加一句：local-dev 默认 `bun run dev` 为 mock，`bun run dev:cognito` 为 Cognito；其余端口与约定不变。 |

---

## 实施状态

设计完成，待产实施计划后按计划开发。
