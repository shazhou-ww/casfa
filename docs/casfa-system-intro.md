# Casfa 系统介绍（beta 版本）

> 读者：应用开发者  
> 版本基线：`https://beta.casfa.shazhou.me`（单域名 + 路径挂载）

---

## 1. Casfa 是什么，解决什么问题

Casfa（Content-Addressable Storage for Agents）是一个面向 Agent Native 应用的系统底座。  
它把内容存储、身份授权、Agent 编排和 MCP 工具接入统一在一套体系内，让“用户、应用、Agent、工具”可以协同工作。

Casfa 主要解决这些问题：

- **内容不可追踪**：工具会执行，但输入输出难以沉淀和追溯。Casfa 用内容寻址和统一数据层提升可追踪性。
- **授权链路割裂**：用户登录、应用权限、Agent 代执行权限常常分散。Casfa 将 OAuth 与 Delegate 机制统一，明确调用身份和边界。
- **MCP 接入重复建设**：各业务重复实现 MCP server、认证、参数校验。Casfa 通过 `@casfa/cell-mcp` 统一 MCP HTTP 服务构建方式。
- **多服务联调成本高**：beta 采用单域路径路由，减少 Cookie、回调地址、跨服务互调差异。

---

## 2. 整体架构（beta）

### 2.1 对外入口

- 主域名：`https://beta.casfa.shazhou.me`
- 主要路径（按 Cell 挂载）：
  - `https://beta.casfa.shazhou.me/sso/`
  - `https://beta.casfa.shazhou.me/drive/`
  - `https://beta.casfa.shazhou.me/agent/`
  - `https://beta.casfa.shazhou.me/artist/`

在部署层面，整体是单域名入口，按路径分发到不同 Cell 的前后端能力。

### 2.2 系统分层

- **Cell 应用层**：`sso`、`drive`、`agent`、`artist`
- **客户端与协议层**：`@casfa/client` 及相关包负责协议、鉴权与调用封装
- **MCP 集成层**：Agent 通过四个元工具进行“发现 + 执行”
  - `list_mcp_servers`
  - `get_mcp_tools`
  - `get_tool_usage`
  - `run_mcp_tool`
- **存储与数据层**：内容寻址 + 文件系统抽象 + 多存储后端（S3/本地/HTTP/缓存）

---

## 3. 三类使用场景

### 3.1 普通用户怎么用

普通用户的典型路径：

1. 访问 `drive` 页面进行内容管理。
2. 通过 `sso` 完成登录。
3. 在 `drive` 管理内容（文件、目录、分支等）。
4. 需要自动化时，通过支持 MCP 的外部 Agent 发起任务，结果回写到 Casfa。

用户侧收益：

- 一次登录，多模块共享会话；
- Agent 操作与内容状态可关联；
- 出错时更容易定位是权限、参数还是工具侧问题。

### 3.2 AI Agent 如何接入 Casfa（Claude Code / Cursor / Copilot CLI / Open Claw）

这里的 Agent 指通用外部 Agent（例如 Claude Code、Cursor、Copilot CLI、Open Claw），而不是仓库里的内部测试 Agent。

接入重点是 MCP server 配置与元工具调用流程。

推荐调用顺序：

1. `list_mcp_servers`：拿到可用 MCP server 列表。
2. `get_mcp_tools(serverId)`：查看指定 server 的 tools。
3. `get_tool_usage(serverId, toolName)`：查看参数 schema 与用法。
4. `run_mcp_tool(serverId, toolName, arguments)`：执行工具。

实践建议：

- 始终使用发现结果中的原始 `serverId` 和 `toolName`；
- 先 discover 再 run，避免参数结构偏差；
- OAuth2 场景先登录拿 token，再调用工具。

### 3.3 MCP tools & client 如何使用 Casfa

#### MCP 工具开发者（Server 侧）

推荐用 `@casfa/cell-mcp`：

- `createCellMcpServer(...)` 初始化服务（可挂 authCheck）
- `registerTool(...)` 注册工具并做 Zod 入参校验
- `registerPrompt(...)` / `registerResource(...)` 补充语义信息
- `getRoute()` 挂到 `POST /mcp`

这样可以统一认证、校验、错误返回格式，减少样板代码。

#### MCP 客户端或上层应用（Client 侧）

可把 Casfa 作为“授权 + 数据 + 调用编排”底座：

1. 在 Casfa 内完成登录与授权上下文建立；
2. 通过 Casfa 能力（如分支/文件）准备工具输入；
3. 调 MCP tool 执行；
4. 将输出结果落回 Casfa 的内容体系。

---

## 4. 如何配置给 Agent 使用

本节面向外部通用 Agent（如 Claude Code / Cursor / Copilot CLI / OpenClaw），按典型产品形态描述配置流程。各工具版本不同，UI 名称可能有差异，但核心参数一致。

### 4.1 通用参数对照（先准备）

接入前建议先准备一份“统一参数表”：

- `id`：server 唯一标识（示例：`casfa-beta`）
- `name`：展示名（示例：`Casfa Beta MCP`）
- `url`：MCP endpoint（通常是 `https://<host>/mcp`）
- `auth`：`none` 或 `oauth2`
- 可选：`client_id`、`client_metadata_url`（OAuth2 时使用）

### 4.2 Claude Code（典型流程）

1. 进入 Claude Code 的 MCP 配置入口（或对应配置文件）。
2. 新增 HTTP MCP server，填写 `id`、`name`、`url`、`auth`。
3. 保存后执行 tools discovery（或等价的刷新操作）。
4. 如果是 OAuth2，按提示完成授权登录，再次 discovery。
5. 在会话中遵循 `list -> get -> usage -> run` 的调用顺序。

### 4.3 Cursor（典型流程）

1. 打开 Cursor 的 MCP Servers / Integrations 配置页。
2. 新增 server，选择 HTTP 传输并填写 `url` 与认证方式。
3. 保存后触发能力发现，确认能看到 tools/schema。
4. OAuth2 场景先完成登录，再执行工具调用。
5. 首次联调建议先调用只读工具验证权限链路。

### 4.4 Copilot CLI（典型流程）

1. 在 Copilot CLI 的 MCP 配置入口（命令或配置文件）注册 server。
2. 填写 `url` 与认证方式，必要时补充 OAuth 参数。
3. 执行 discovery/validate，确认 server 与 tools 可见。
4. 如需 OAuth 登录，先完成认证并保存凭据。
5. 再按 `list_mcp_servers -> get_mcp_tools -> run_mcp_tool` 执行任务。

### 4.5 OpenClaw（典型流程）

1. 在 OpenClaw 的 MCP provider 配置中新增 Casfa server。
2. 配置 `url`、`auth` 和可选 OAuth 字段。
3. 触发 capability 同步，确认 tools 列表已加载。
4. 如果返回 401/403，先完成授权再重试 discovery。
5. 严格按“先发现后执行”模式调用，避免参数不匹配。

### 4.6 通用排错清单

- **401/403**：优先检查登录态、scope（如 `use_mcp`）和权限边界。
- **server/tool not found**：以 discovery 返回的原始 `serverId`/`toolName` 为准，不手写猜测值。
- **参数校验失败**：先看 `get_tool_usage` 的 `inputSchema`，按 schema 修正 arguments。
- **能发现但不能执行**：常见于 token 失效或权限不足，重新认证后再试。

---

## 5. 如何实现基于 Casfa 的 MCP 服务

### 5.1 最小实现流程

1. 在 Cell 后端暴露 `POST /mcp` 路由。
2. 用 `@casfa/cell-mcp` 创建 MCP server。
3. 用 Zod 定义每个 tool 的 `inputSchema`。
4. 在 handler 中实现业务逻辑，并返回 MCP 标准结果（失败场景加 `isError`）。
5. 按需提供 prompt/resource，增强 Agent 的可用性和可解释性。

### 5.2 工程约定建议

- 输入参数显式化，避免“万能对象”。
- 错误信息可读、可定位、可重试。
- 区分 401（未认证）与 403（无权限）。
- Prompt/Resource 中写清工具边界、参数含义和失败策略。

---

## 6. 总结

在 beta 形态下，Casfa 已形成三条统一主线：

- 面向用户：单域多 Cell 的统一入口体验；
- 面向外部 Agent：统一的 MCP 发现与执行模型；
- 面向开发者：统一的 MCP 服务构建方式。

这让 Casfa 不只是“一个存储系统”，而是可支撑 AI 应用长期演进的基础平台。
