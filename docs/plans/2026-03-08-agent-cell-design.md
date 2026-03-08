# Agent Cell 设计

> 新建 Agent Cell（apps/agent）：前端直连可配置 LLM（provider + model 两级），后端仅同步 settings 与 thread/message 数据；鉴权复用 SSO + Cookie，合并策略为 settings 按 key、messages 按 thread 追加。

## 1. 目标与架构总览

**目标**

- 新增 **Agent Cell**（`apps/agent`），提供可配置 LLM 的对话能力。
- **前端**：直接请求可配置的大模型 API（provider = url + api key，每个 provider 多个 model）；所有 LLM 请求从前端发起、前端接收。
- **后端**：只负责 **settings** 与 **messages**（thread + message 两级）的跨设备同步；鉴权复用现有 SSO + Cookie，按 realm 隔离数据。

**架构**

- **Cell**：与 server-next、sso、image-workshop 同级，`apps/agent`，含 `cell.yaml`（backend + frontend + tables + domain + params）、backend（Hono + 鉴权中间件）、frontend（SPA）。
- **鉴权**：与 server-next 一致——未登录重定向到 SSO，登录后 Cookie 带 JWT；后端从 JWT 取 realm（用户），所有 API 按 realm 隔离。
- **同步方式**：无服务端推送；前端在进入应用、切换 thread、定时或窗口 focus 时拉取数据，与本地状态按「settings 按 key 合并、messages 按 thread 追加」策略合并。

**不包含（第一版）**

- 后端不代理或转发 LLM 请求；不实现 WebSocket/SSE 服务端推送；不实现 thread 共享/协作。

---

## 2. 数据模型（表结构）

### 2.1 Threads 表

- **主键**：`pk = REALM#{realm}`，`sk = THREAD#{threadId}`（threadId 建议 ULID 或 `thr_` 前缀 + Crockford Base32）。
- **属性**：`threadId`、`title`（可选，可编辑）、`createdAt`、`updatedAt`（毫秒时间戳）。可选：`modelId`（该 thread 当前/默认使用的 model，便于多端一致）。
- **GSI**（按 realm 按时间排序列表）：`gsi1pk = REALM#{realm}`，`gsi1sk = THREAD#{updatedAt}#{threadId}`，projection ALL，用于「我的对话列表」分页。

### 2.2 Messages 表

- **主键**：`pk = THREAD#{threadId}`，`sk = MSG#{createdAt}#{messageId}`（或 `sk = MSG#{messageId}`，用 messageId 含时间成分保证顺序）。messageId 建议 ULID。
- **属性**：`messageId`、`threadId`、`role`（`user` | `assistant` | `system`）、`content`（见下）、`createdAt`。
- **content 形态**：第一版仅支持纯文本，但用**可扩展结构**存储：`content: Array<{ type: 'text', text: string }>`；后续可加 `type: 'image'` 等，前端渲染时按 type 处理。
- **GSI**：若需「按 realm 查某用户全部 message」（如搜索），可加 `gsi1pk = REALM#{realm}`，`gsi1sk = MSG#{threadId}#{createdAt}#{messageId}`；否则第一版可仅按 thread 查，不建 GSI。

### 2.3 Settings 表（按 key 合并）

- **主键**：`pk = REALM#{realm}`，`sk = SETTING#{key}`（key 如 `llm.providers`、`ui.theme`、`threadDefaults.modelId` 等）。
- **属性**：`key`、`value`（JSON，类型由 key 约定）、`updatedAt`。
- **合并语义**：同一 key 多端写入时，以 `updatedAt` 较新者为准（LWW per key）；不同 key 互不影响。前端拉取后按 key 与本地合并（服务端更新则覆盖本地该 key）。

### 2.4 LLM 配置在 settings 中的形态（约定 key）

- **key**：如 `llm.providers`。
- **value**：JSON 数组，例如：
  - `{ id: string, name?: string, baseUrl: string, apiKey: string, models: Array<{ id: string, name?: string }> }`
  - `apiKey` 可为空字符串（表示未配置），前端不把未配置的 provider 用于请求。
- 前端读取 `llm.providers`，选择 provider + model，直连 `provider.baseUrl`（兼容 OpenAI 风格 path，如 `/v1/chat/completions`），header 带 `Authorization: Bearer <apiKey>` 或该 provider 约定方式。

### 2.5 与 cell.yaml 的对应

- 在 agent 的 `cell.yaml` 中声明三张表：`threads`、`messages`、`settings`，主键与 GSI 与上述一致，由 cell-cli 部署时创建/更新表。

---

## 3. 后端 API（REST 形状、鉴权、错误码）

### 3.1 鉴权与 Realm

- 所有 API 需登录：从 Cookie 读取 JWT（与 SSO 约定一致），校验签名与有效期；失败返回 401，前端重定向到 SSO 登录。
- 写操作（POST/PATCH/DELETE）校验本域 CSRF：`X-CSRF-Token` 与 cookie 中 csrf_token 一致，否则 403。
- Realm 从 JWT 的 `sub` 或现有约定字段解析，所有读写按 `realm` 隔离；不接收路径或 body 中的 realm，避免越权。

### 3.2 Threads

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/realm/threads` | 列表，分页：`limit`、`cursor`（可选）。按 `updatedAt` 降序，返回 `threadId`、`title`、`createdAt`、`updatedAt`、可选 `modelId`。 |
| POST | `/api/realm/threads` | 创建：body `{ title?: string, modelId?: string }`，返回完整 thread。 |
| GET | `/api/realm/threads/:threadId` | 单条详情，不存在 404。 |
| PATCH | `/api/realm/threads/:threadId` | 更新 `title`、`modelId` 等可写字段，返回完整 thread。 |
| DELETE | `/api/realm/threads/:threadId` | 软删或硬删（实现时定），并删除该 thread 下所有 messages（或同事务）。返回 204 或 `{ success: true }`。 |

### 3.3 Messages

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/realm/threads/:threadId/messages` | 列表，分页：`limit`、`cursor`（可选）。按 `createdAt` 升序，返回 `messageId`、`role`、`content`、`createdAt`。需校验 thread 属于当前 realm。 |
| POST | `/api/realm/threads/:threadId/messages` | 创建：body `{ role, content: Array<{ type: 'text', text: string }> }`，返回完整 message（含 `messageId`、`createdAt`）。 |
| PATCH | `/api/realm/threads/:threadId/messages/:messageId` | 可选：编辑单条（如 user 消息），第一版可不实现。 |
| DELETE | `/api/realm/threads/:threadId/messages/:messageId` | 可选：删除单条，第一版可不实现。 |

### 3.4 Settings

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/realm/settings` | 返回当前 realm 全部 settings：`{ items: Array<{ key, value, updatedAt }> }` 或 `{ [key]: { value, updatedAt } }`。 |
| GET | `/api/realm/settings/:key` | 单 key（如 `llm.providers`），不存在返回 404 或 `{ value: null }`（约定其一）。 |
| PUT 或 PATCH | `/api/realm/settings/:key` | 写入/更新：body `{ value }`，服务端写表并设 `updatedAt = now`，返回 `{ key, value, updatedAt }`。合并语义：按 key LWW。 |

### 3.5 错误码与格式

- 400：参数校验失败（如缺少必填、content 格式不符）；body 可带 `{ code, message, details? }`。
- 401：未登录或 token 无效；前端跳 SSO。
- 403：无权限（如 CSRF 失败、thread 不属于本 realm）。
- 404：thread / message / setting key 不存在。
- 500：服务端错误，不暴露内部细节。

### 3.6 路径前缀

- 统一用 `/api/realm/threads`、`/api/realm/threads/:threadId/messages`、`/api/realm/settings`，与「按 realm 隔离」语义一致；前端 baseUrl 指向 agent 的 backend 即可。

---

## 4. 前端职责（LLM 配置、调用、同步与合并）

**技术栈**：前端继续使用 **MUI (Material-UI)** 开发，与现有 casfa 应用保持一致。

### 4.1 数据来源与拉取时机

- 前端维护本地状态：当前用户的 **threads 列表**、**当前 thread 的 messages**、**settings**（含 `llm.providers` 等）。
- **拉取时机**：应用首次加载（或从 SSO 回调回来）、切换 thread、定时（如每 30–60s）、窗口 `focus` 时。可先实现「进入页拉取 + 切换 thread 拉取」，再叠加定时/focus。
- 所有请求带 Cookie（同源）及写操作带 `X-CSRF-Token`；baseUrl 指向当前 origin（与 server-next 一致），部署后即 agent 的 backend 域名。

### 4.2 Settings 合并策略（按 key）

- 拉取到服务端 settings 后：对每个 key，若服务端有且 `updatedAt` 大于本地该 key 的 `updatedAt`，则用服务端覆盖本地；若本地有而服务端无（或本地更新），则保留本地并可选上传该 key（PUT/PATCH）以同步到服务端。
- 冲突：同一 key 多端都改时，以 **服务端最新一次写入为准**（LWW per key）；前端展示以「拉取后的合并结果」为准，不再做多路合并。

### 4.3 Threads / Messages 合并策略（按 thread 追加）

- **Threads 列表**：以服务端为权威。拉取后替换本地列表（或按 `updatedAt` 合并去重，同一 threadId 保留 updatedAt 更大者）；本地新建未提交的 thread 先 POST 再拉取，避免丢失。
- **Messages**：以服务端为权威顺序。拉取某 thread 的 messages 后，与本地该 thread 的「未提交」消息合并：**服务端列表按 createdAt 有序；本地未提交的（尚未 POST 或 POST 未返回）按客户端顺序插在对应位置或末尾**。若某条已 POST 且服务端已返回，则以服务端为准；若两端同时追加，服务端时间戳为准，前端按合并后的顺序展示。

### 4.4 LLM 配置的读取与展示

- 从 settings 读取 `llm.providers`（若不存在则为 `[]`）。展示：provider 列表（name/baseUrl）、每个 provider 下的 model 列表；apiKey 仅用于请求，不在 UI 明文展示（或脱敏）。
- 支持增删改 provider、为 provider 增删 model（id/name），通过 PUT/PATCH `/api/realm/settings/llm.providers` 写回，并更新本地 state 与 `updatedAt`。

### 4.5 发起 LLM 请求（前端直连）

- 用户选好 provider + model，在某个 thread 里发送消息。前端：将用户消息先写入本地并可选立即 POST 到 `/api/realm/threads/:threadId/messages`；再根据 thread 的 messages（含刚写入的）构造 history，向 **当前 provider 的 baseUrl** 发请求（如 `POST {baseUrl}/v1/chat/completions`），body 为 OpenAI 风格 `{ model, messages: [{ role, content }], stream?: false }`，header 带 `Authorization: Bearer {apiKey}`。
- 流式：若 provider 支持 SSE，可用 `stream: true`，前端用 EventSource 或 fetch + ReadableStream 消费，每收到一段就更新 UI；**assistant 的完整内容在流结束后再 POST 一条 message** 到后端，保证跨端同步的是完整消息。
- 错误：网络/4xx/5xx 由前端提示用户，不经过后端代理；apiKey 无效等由前端统一提示「请检查该 provider 的 API Key」。

### 4.6 乐观更新与提交顺序

- 用户发送消息：可先写本地 messages（user + 占位 assistant），再 POST user message，再发 LLM 请求，收到完整 assistant 后 POST assistant message，并更新本地。若 POST 失败，可重试或标记「未同步」，下次拉取时以服务端为准并提示冲突/丢失。

---

## 5. 错误处理与测试要点

### 5.1 后端错误处理

- **401**：未登录或 JWT 无效 → 返回 JSON `{ code: 'UNAUTHORIZED', message: '...' }`，前端跳转 SSO 登录（带 return_url）。
- **403**：CSRF 失败或 thread 不属于当前 realm → `{ code: 'FORBIDDEN', message: '...' }`，前端提示并可选刷新 CSRF 后重试。
- **404**：thread / message / setting key 不存在 → `{ code: 'NOT_FOUND', message: '...' }`，前端更新列表或提示「对话不存在」。
- **400**：body 校验失败（如 content 非数组、role 非法）→ `{ code: 'VALIDATION_ERROR', message: '...', details?: [...] }`。
- **500**：统一捕获，记录日志，返回通用错误信息，不暴露堆栈。

### 5.2 前端错误处理

- **LLM 直连失败**：网络错误、4xx/5xx、超时 → 提示「请求失败，请检查网络或 API 配置」；401/403 提示「API Key 可能无效或已过期」。
- **同步 API 失败**：拉取或 POST 失败时重试 1–2 次（可指数退避）；仍失败则标记「未同步」或展示错误，下次拉取时以服务端为准。
- **合并后冲突**：若采用「服务端为权威」，一般无需额外冲突 UI；若有「未提交丢失」风险，可在 UI 提示「部分内容未同步，已以服务器为准」。

### 5.3 测试要点

- **后端单元**：鉴权中间件（无 token / 无效 token → 401；错误 realm → 403）；threads/messages/settings 的 CRUD；settings 按 key 的 LWW 语义；messages 按 thread 归属校验。
- **后端集成/接口**：POST thread → GET 列表含新 thread；POST message → GET messages 含新 message；PUT setting → GET 返回新 value 与 updatedAt。
- **前端**：合并逻辑（settings 按 key、messages 按 thread 追加）的单元或集成测试；LLM 直连用 mock 或测试用 provider，不依赖真实 API Key。
- **E2E（可选）**：登录 → 创建 thread → 发消息 → 刷新后列表与消息仍在；或双 tab 下改 settings 后另一 tab 拉取看到更新。
