# Agent Cell: Service Worker ModelState 设计

## 1. 目标与范围

- **目标**：将 Agent 前端状态拆成 **ModelState**（SW 维护、跨 tab 共享）与 **ViewState**（各页面自维护）；所有 API 与 LLM 流式由 SW 执行；流式过程中刷新页面可恢复（chunk 归属 messageId，多 thread 可同时流式）。
- **范围**：cell 通用能力（SW + RPC/消息协议 + IDB）；Agent 为首个使用方。

## 2. 状态划分

| 状态 | 维护方 | 作用域 | 说明 |
|------|--------|--------|------|
| **ModelState** | Service Worker | 跨 tab 共享，持久化到 IndexedDB | threads、messages 按 thread、每条消息的流式状态、settings |
| **ViewState** | 各页面 | 单 tab | 路由（当前 threadId、是否在 settings）、输入框内容等 |

- 数据流：**Action**（UI → SW）→ SW 执行并更新 ModelState → **Change**（SW → 各 tab）→ UI 更新本地 ModelState 镜像。
- ModelState **不**包含 currentThread；多个 thread 可同时有进行中的流式。

---

## 3. 关键数据类型

### 3.1 Content 与 Message

```ts
// 消息内容片段（支持 text / tool-call / tool-result，便于后续扩展）
type TextContent = { type: "text"; text: string };

type ToolCallContent = {
  type: "tool-call";
  callId: string;
  name: string;
  arguments: string; // JSON string，流式时可能增量追加
};

type ToolResultContent = {
  type: "tool-result";
  callId: string;
  result: string; // 或结构化，视后端约定
};

type MessageContent = TextContent | ToolCallContent | ToolResultContent;

type Message = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: MessageContent[];
  createdAt: number;
  /** 仅 assistant 消息可选；表示生成该回复所用的 model */
  modelId?: string;
};
```

- 每条消息必有 **messageId**；流式 chunk 归属到正在生成的那条 assistant 消息的 messageId。

### 3.2 Thread

```ts
type Thread = {
  threadId: string;
  title: string; // 必选
  createdAt: number;
  updatedAt: number;
};
```

- Thread **不**带 modelId；若需“当前 thread 用的 model”，可由该 thread 最后一条 assistant 的 modelId 或 ViewState 表示。

### 3.3 流式 Chunk（支持 text + tool-call 增量）

```ts
type StreamStatus =
  | "waiting_agent"
  | "streaming"
  | "done"
  | "error";

// 流式增量：文本片段 或 tool-call 片段（与 Content 对应，便于拼接成 content 数组）
type TextChunk = { type: "text"; text: string };

type ToolCallChunk = {
  type: "tool-call";
  index?: number;   // 对应 delta.tool_calls[index]
  callId?: string;
  name?: string;
  arguments?: string; // 增量
};

type StreamChunk = TextChunk | ToolCallChunk;

type StreamState = {
  messageId: string;
  threadId: string;
  status: StreamStatus;
  /** 已收到的流式片段，按顺序拼接/合并后得到 content */
  chunks: StreamChunk[];
  error?: string;
  startedAt: number;
};
```

- chunk 通过 **messageId** 归属；SW 用 `Record<messageId, StreamState>` 管理，多 thread 同时流式互不干扰。

### 3.4 ModelState（SW 内）

```ts
type ModelState = {
  threads: Thread[];
  messagesByThread: Record<string, Message[]>;
  streamByMessageId: Record<string, StreamState>;
  settings: Record<string, unknown>;
};
```

---

## 4. Action（UI → SW）

```ts
type Action =
  | { kind: "threads.create"; payload: { title: string } }
  | { kind: "threads.delete"; payload: { threadId: string } }
  | { kind: "messages.send"; payload: { threadId: string; content: MessageContent[] } }
  | { kind: "stream.cancel"; payload: { messageId: string } }
  | { kind: "settings.update"; payload: { key: string; value: unknown } }
  | { kind: "sync.pull"; payload?: { scope?: "threads" | "messages" | "settings" } };
```

- 传输层：`{ type: "action", id?: string, action: Action }`（id 用于需要响应的请求）。

---

## 5. Change（SW → 各 Tab，增量）

```ts
// 增量：仅新增
type ChangeMessagesAppend = {
  kind: "messages.append";
  payload: { threadId: string; message: Message };
};

// 增量：单条消息更新（如流式推进、content 追加）
type ChangeMessagesPatch = {
  kind: "messages.patch";
  payload: { threadId: string; messageId: string; patch: Partial<Pick<Message, "content" | "modelId">> };
};

// 增量：删除（若后端支持）
type ChangeMessagesRemove = {
  kind: "messages.remove";
  payload: { threadId: string; messageId: string };
};

type Change =
  | { kind: "threads.updated"; payload: { threads: Thread[] } }  // 列表可后续再拆增量
  | ChangeMessagesAppend
  | ChangeMessagesPatch
  | ChangeMessagesRemove
  | { kind: "stream.status"; payload: { messageId: string; threadId: string; status: StreamStatus; error?: string } }
  | { kind: "stream.chunk"; payload: { messageId: string; threadId: string; chunk: StreamChunk } }
  | { kind: "stream.done"; payload: { messageId: string; threadId: string; message: Message } }
  | { kind: "stream.error"; payload: { messageId: string; threadId: string; error: string } }
  | { kind: "settings.updated"; payload: { key: string; value?: unknown } }
  | { kind: "response"; payload: { id: string; result?: unknown; error?: { code: string; message: string } } };
```

- messages 以 **append / patch / remove** 增量下发，避免每次全量传 messages 越来越大。

---

## 6. SW ↔ UI 消息协议

- **通道**：MessagePort（或 postMessage）用于 request/response + 所有 Change 推送；流式 chunk 可复用同一通道或单独 BroadcastChannel（由实现决定）。
- **格式**：
  - 客户端 → SW：`{ type: "action", id?: string, action: Action }`
  - SW → 客户端：`{ type: "change", changes: Change[] }`（可单条或多条合并一次推送）
- UI 根据 `change.kind` 更新本地 ModelState 镜像（Zustand 等），再驱动渲染。

---

## 7. IndexedDB（与 ModelState 对应）

- **threads**：存 `Thread[]` 或按 threadId 单条；index 按 updatedAt。
- **messages**：存 `Message`；keyPath 或 index 含 threadId、messageId、createdAt。
- **stream_state**：key = messageId，存 `StreamState`；流式结束并落库后删除。
- **settings**：key-value。

（具体 keyPath/index 在实现时定；类型与 §3 一致。）

---

## 8. 后续步骤

- 实现计划（SW 注册、RPC/端口、IDB 读写、流式与恢复、UI 消费 Changes、后端 API 与 Message/Thread 字段对齐）见单独 implementation plan 文档。
