# Casfa 系统介绍（beta.casfa.shazhou.me）

> 面向对象：应用开发者  
> 基线版本：`beta.casfa.shazhou.me` 当前部署形态（单域名 + 路径挂载）

---

## 1. Casfa 是什么，解决什么问题

Casfa（Content-Addressable Storage for Agents）是一个面向 AI Agent 和多应用协作场景的内容寻址系统。它把“文件存储、权限授权、Agent 调用、MCP 工具接入”统一在一个协议和平台里，避免每个应用重复造轮子。

Casfa 主要解决四类问题：

1. **文件与状态管理割裂**  
   传统 Agent 系统常见“工具会调用，但产物不可追踪”。Casfa 把内容组织到可寻址结构中，便于追踪、复用和回滚。

2. **授权模型不统一**  
   用户登录态、应用侧授权、Agent 代调用权限往往分散。Casfa 提供统一的 OAuth / Delegate 思路，把“谁在以谁的身份做什么”明确下来。

3. **MCP 接入成本高**  
   每个业务都要独立实现 MCP server、认证、参数校验和错误处理。Casfa 提供 `@casfa/cell-mcp`，把 MCP HTTP 服务抽象成 Builder，降低接入复杂度。

4. **多微服务联调困难**  
   Casfa 在 beta 采用单域名路径路由（如 `/sso/`、`/drive/`、`/agent/`），让浏览器 Cookie、OAuth 回调、跨服务调用行为更接近线上。

---

## 2. 整体架构（beta 当前形态）

### 2.1 入口与路由

- 对外主域名：`https://beta.casfa.shazhou.me`
- 当前按路径挂载多个 Cell：
  - `https://beta.casfa.shazhou.me/sso/`
  - `https://beta.casfa.shazhou.me/drive/`
  - `https://beta.casfa.shazhou.me/agent/`
  - `https://beta.casfa.shazhou.me/artist/`（同栈定义中存在）
- 架构上是 **CloudFront + 路径行为（path behaviors）+ 各 Cell 后端/前端**

### 2.2 逻辑分层

1. **应用层（Cells）**  
   `sso`（认证）、`drive`（文件/分支等核心能力）、`agent`（Agent 对话与 MCP 编排）、`artist`（图像生成 MCP）。

2. **客户端与协议层**  
   通过 `@casfa/client` 及相关包统一处理认证、调用协议、数据结构和前后端桥接。

3. **MCP 集成层**  
   Agent 侧使用“渐进式发现 + 单一执行入口”模式：
   - `list_mcp_servers`
   - `get_mcp_tools`
   - `get_tool_usage`
   - `run_mcp_tool`

4. **存储与内容层**  
   底层由 CAS（内容寻址）与 FS 抽象支撑，结合多种存储实现（本地、S3、HTTP、缓存等）。

---

## 3. 三类使用场景

### 3.1 普通用户怎么用

普通用户通常不直接关心 MCP 或内部协议，核心流程是：

1. 打开 `drive` 或 `agent` 页面。
2. 通过 `sso` 登录，建立统一登录态。
3. 在 `drive` 管理内容（文件、目录、分支等）。
4. 在 `agent` 里发起任务，由 Agent 调 MCP 工具完成操作。

对普通用户来说，Casfa 的价值是：
- 同一登录态跨多个功能模块复用；
- Agent 能对内容进行“可追踪”的操作；
- 工具调用失败时能给出更明确的错误上下文。

### 3.2 AI Agent 如何接入 Casfa

Agent 接入重点有两部分：**配置 MCP server** 与 **按元工具调用**。

在 Agent 设置里可配置多个 MCP server（HTTP URL、认证方式、可选 OAuth 参数）。  
运行时推荐流程：

1. 调 `list_mcp_servers` 获取可用 server。
2. 对目标 server 调 `get_mcp_tools` 看有哪些工具。
3. 必要时调 `get_tool_usage` 获取工具参数 schema/用法细节。
4. 最终通过 `run_mcp_tool` 执行具体工具。

实践建议：
- 始终使用上一步返回的 `serverId`、`toolName` 原值，避免拼写偏差。
- 先 discover 再 run，减少“参数不匹配”错误。
- 对 OAuth2 的 server，先完成登录拿 token，再执行工具。

### 3.3 MCP tools & client 如何使用 Casfa

这里分两类开发者：

1. **MCP 工具开发者（Server 侧）**  
   推荐用 `@casfa/cell-mcp` 快速搭建 HTTP MCP 服务：
   - `createCellMcpServer({ name, version, authCheck, onUnauthorized })`
   - `registerTool(name, { description, inputSchema }, handler)`（Zod 校验）
   - `registerResource(...)` / `registerPrompt(...)`
   - `getRoute()` 挂到 `POST /mcp`

   好处是认证、输入校验、标准 MCP 接口都被统一封装，减少样板代码。

2. **MCP Client / 应用调用方**  
   可把 Casfa 当作“可授权的数据与能力底座”：
   - 通过 Casfa 的登录与授权获取调用上下文；
   - 调用 Casfa 能力（如分支/文件相关 API）准备业务输入；
   - 再通过 MCP tool 执行任务，把结果回写到 Casfa 内容树。

一个常见模式是：
- 在 `drive` 侧创建或准备数据上下文（如分支 URL）；
- 将该上下文传给某个 MCP tool（例如图像/内容生成工具）；
- 工具完成后把结果内容写回 Casfa，并完成分支合并。

---

## 4. 如何配置给 Agent 使用（落地步骤）

以下以“在 Agent 中新增一个 HTTP MCP server”为例：

1. 打开 Agent 的 MCP Servers 配置面板。
2. 填写：
   - `Name`：可读名称
   - `Transport`：HTTP
   - `URL`：MCP endpoint（通常是 `https://<host>/mcp`）
   - `Auth`：`none` 或 `oauth2`
   - 若 `oauth2`：可填 `Client ID` / `Client metadata URL`
3. 保存后执行 capability discovery（验证 tools/prompts/resources）。
4. 若提示需要认证，先完成 OAuth 登录，再重新 discovery。
5. 在对话中按 `list -> get -> usage -> run` 顺序调用。

排错建议：
- 401/403：优先检查登录态、scope（如 `use_mcp`）和 Cookie 域设置。
- “server not found / tool not found”：通常是 `serverId`/`toolName` 不一致，回到 discovery 结果复制原值。
- 参数错误：先看 `get_tool_usage` 返回的 schema，再修正 arguments。

---

## 5. 如何实现基于 Casfa 的 MCP 服务（开发模板）

### 5.1 最小实现思路

1. 在 Cell 后端创建 MCP route（`POST /mcp`）。
2. 使用 `@casfa/cell-mcp` 创建 server，接入统一 authCheck。
3. 用 Zod 定义每个 tool 的 `inputSchema`。
4. handler 内执行业务逻辑，返回 MCP 标准 `content`（错误场景设置 `isError`）。
5. 需要时注册 prompt/resource，帮助 Agent 更好理解工具语义。

### 5.2 推荐约定

- Tool 输入尽量显式（避免“任意 object”）。
- 错误信息可读且可重试（包含字段级提示）。
- 认证失败区分 401（未登录）与 403（已登录但无权限）。
- 把可复用说明放入 prompt/resource，减少 Agent 误用。

### 5.3 与 Casfa 体系对齐的关键点

- 权限：与 Casfa OAuth/Delegate 权限模型保持一致（例如 `use_mcp`）。
- 数据：优先把输入输出落在 Casfa 可寻址内容里，便于追踪。
- 路由：遵循单域路径挂载约定，保证 dev/beta/prod 一致性更高。

---

## 6. 总结

在 `beta.casfa.shazhou.me` 的最新设计下，Casfa 已形成：

- 面向用户的统一入口（单域多 Cell）；
- 面向 Agent 的统一 MCP 调用模式（discover + run）；
- 面向开发者的统一 MCP 服务构建方式（`@casfa/cell-mcp`）。

这让 Casfa 同时具备“可用性”（普通用户）、“可编排性”（Agent）、“可扩展性”（MCP 开发）三方面能力，适合作为 Agent Native 应用的基础平台。
