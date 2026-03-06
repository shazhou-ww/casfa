# MCP Skill Discovery 协议设计

## 1. 背景与目标

### 现状

mitsein 通过自定义 AWP（Agent Worker Protocol）协议与外部工具服务通信，使用 JSON-RPC 扩展方法 `skills/list`、`tools/list`、`tools/call`。Skill 以 ZIP 包分发，包含 `SKILL.md` 描述文件。image-workshop 已迁移为标准 MCP server，但 mitsein 侧仍使用 AWP 协议对接。

### 目标

1. 废弃自定义 AWP 协议，全面采用标准 MCP 协议
2. 利用 MCP `resources` 机制实现 skill 发现，复用性好、协议标准
3. 同步更新 mitsein 中的整个配置流程和协议
4. 保留 CASFA 上下文注入能力（branch 创建 + token 注入）

### 废弃清单

| 组件 | 位置 | 替代 |
|------|------|------|
| `AWPClient` | `awp/client.py` | MCP SDK `ClientSession` |
| `AWPBlobProcessor` | `awp/blob_processor.py` | 删除（不再需要 S3 presigned URL） |
| `AWPSchemaTransformer` | `awp/schema_transformer.py` | 删除（不再需要 url→prefix 转换） |
| `protocol.py` | `awp/protocol.py` | 删除（不再需要自定义 JSON-RPC） |
| `AWPSkillRegistry` | `registry/awp.py` | `MCPSkillRegistry` |
| `AWPToolHandler` | `awp/tool_handler.py` | `MCPToolHandler` |
| `CasfaBlobProcessor` | `awp/casfa_blob_processor.py` | `CasfaContextInjector`（重构） |
| Hash alias 计算 | `utils/hash.py` | 使用 MCP server name 作为可读前缀 |
| HMAC / Bearer 自定义 auth | `auth/` | MCP 标准 OAuth 流程 |

---

## 2. Skill 发现协议

### 2.1 核心机制

MCP server 通过 `resources` 暴露 skill 描述。Client 通过 **URI scheme** + **annotations** 双重标识识别 skill 类型的 resource。

### 2.2 Skill Resource 定义

#### URI 规范

```
skill://{skill-id}
```

- `skill-id`：kebab-case 标识符，全局唯一（在单个 MCP server 范围内）
- 示例：`skill://flux-image-gen`、`skill://background-removal`

#### Resource 元数据

MCP server 在 `resources/list` 中返回：

```json
{
  "resources": [
    {
      "uri": "skill://flux-image-gen",
      "name": "FLUX Image Generation",
      "mimeType": "text/markdown",
      "annotations": {
        "type": "skill"
      }
    }
  ]
}
```

识别规则（双重标识）：
1. URI 以 `skill://` 开头
2. `annotations.type === "skill"`

两个条件同时满足才视为 skill resource。

#### Resource 内容

MCP server 在 `resources/read` 中返回 SKILL.md 全文：

```json
{
  "contents": [
    {
      "uri": "skill://flux-image-gen",
      "mimeType": "text/markdown",
      "text": "---\nname: \"FLUX Image Generation\"\ndescription: \"Generate images from text prompts using BFL FLUX\"\nversion: \"1.0.0\"\ncategory: \"image\"\nauthor: \"casfa\"\nallowed-tools: [\"flux_image\"]\n---\n\n# FLUX Image Generation\n\nGenerate high-quality images from text prompts...\n"
    }
  ]
}
```

### 2.3 SKILL.md 格式

沿用现有 SKILL.md 格式，YAML frontmatter + Markdown body：

```markdown
---
name: "FLUX Image Generation"
description: "Generate images from text prompts using BFL FLUX"
version: "1.0.0"
category: "image"
author: "casfa"
license: "MIT"
allowed-tools: ["flux_image"]
---

# FLUX Image Generation

## 概述

使用 BFL FLUX 模型从文本提示生成高质量图像。

## 使用方式

...（agent 可读的 skill 指导内容）
```

#### Frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Skill 显示名 |
| `description` | string | 是 | 简短描述 |
| `version` | string | 是 | 语义化版本 |
| `category` | string | 否 | 分类（image、text、code 等） |
| `author` | string | 否 | 作者 |
| `license` | string | 否 | 许可证 |
| `allowed-tools` | string[] \| "*" | 是 | 该 skill 允许使用的 tool 列表，`"*"` 表示所有 |

### 2.4 MCP Server 侧实现（TypeScript）

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const SKILL_CONTENT = `---
name: "FLUX Image Generation"
description: "Generate images from text prompts using BFL FLUX"
version: "1.0.0"
category: "image"
allowed-tools: ["flux_image"]
---

# FLUX Image Generation
...
`;

function registerSkillResources(server: McpServer): void {
  server.registerResource(
    {
      uri: "skill://flux-image-gen",
      name: "FLUX Image Generation",
      mimeType: "text/markdown",
      annotations: { type: "skill" },
    },
    async () => ({
      contents: [
        {
          uri: "skill://flux-image-gen",
          mimeType: "text/markdown",
          text: SKILL_CONTENT,
        },
      ],
    })
  );
}
```

---

## 3. 工具发现与命名

### 3.1 工具发现

使用标准 MCP `tools/list` 获取工具 schema，不再需要自定义协议。

### 3.2 工具命名（Server Name 前缀）

MCP `initialize` 响应中的 `serverInfo.name` 作为工具名前缀：

```
{server_name}__{tool_name}
```

规则：
- `server_name` 中的 `-` 替换为 `_`（符合 LLM tool name 约束）
- 双下划线 `__` 作为分隔符
- 示例：server name `image-workshop` + tool `flux_image` → `image_workshop__flux_image`

用途：
1. **去重**：多个 MCP server 可能有同名 tool
2. **路由**：`ToolExecutor` 按 `__` 分割，前缀查找对应的 MCP session

### 3.3 Skill → Tools 绑定

通过 SKILL.md frontmatter 中的 `allowed-tools` 字段声明。Agent 加载某个 skill 后，只暴露该 skill 允许的 tools 给 LLM。

```yaml
allowed-tools: ["flux_image"]        # 指定 tool 列表
allowed-tools: "*"                    # 允许所有 tools
```

绑定在 client 侧（mitsein）解析和执行，MCP server 不感知。

---

## 4. 工具调用与 CASFA 上下文注入

### 4.1 调用流程

```
LLM 调用 "image_workshop__flux_image"
  → ToolExecutor 分割: ("image_workshop", "flux_image")
  → MCPSkillRegistry 查找 session: sessions["image-workshop"]
  → CasfaContextInjector 注入 CASFA 参数
  → MCP tools/call("flux_image", enriched_args)
  → 返回结果
```

### 4.2 CasfaContextInjector

从 `CasfaBlobProcessor` 重构，只保留 CASFA 上下文注入职责：

```python
class CasfaContextInjector:
    """在 MCP tools/call 前注入 CASFA branch 上下文。"""

    async def inject(
        self,
        account_id: str,
        arguments: dict,
    ) -> dict:
        """创建 CASFA branch 并注入访问参数。"""
        # 1. 创建 delegate token
        delegate = await create_delegate_token(
            account_id, can_upload=True
        )

        # 2. 注入到 tool 参数
        enriched = {**arguments}
        enriched["casfaBaseUrl"] = delegate.endpoint
        enriched["branchAccessToken"] = f"{delegate.access_token_id}:{delegate.access_token_base64}"

        return enriched
```

### 4.3 注入触发条件

检查 tool 的 inputSchema 是否包含 `casfaBaseUrl` 和 `branchAccessToken` 参数。如果包含，自动注入；否则跳过。

```python
def needs_casfa_injection(tool_schema: dict) -> bool:
    props = tool_schema.get("inputSchema", {}).get("properties", {})
    return "casfaBaseUrl" in props and "branchAccessToken" in props
```

---

## 5. 认证

### 5.1 MCP 标准 OAuth

mitsein 作为 MCP client，连接 MCP server 时使用标准 OAuth 流程：

```
1. GET /.well-known/oauth-authorization-server
   → 获取 authorization_endpoint, token_endpoint, registration_endpoint

2. POST /oauth/register
   → 动态注册 client（获取 client_id）

3. GET /oauth/authorize?response_type=code&client_id=...&code_challenge=...
   → 用户授权（或服务间直接获取 token）

4. POST /oauth/token
   → code → access_token + refresh_token

5. 后续请求携带 Authorization: Bearer {access_token}
   → MCP server 校验 token
```

### 5.2 系统级 Endpoint 认证

系统级 MCP endpoint（如 image-workshop）需要服务间认证，不走用户交互式 OAuth。两种方案：

**方案 A：预配置 Delegate Token**

在 `.env` 中配置 MCP server 的长期 delegate token：

```bash
SYSTEM_MCP_ENDPOINTS='[
  {
    "url": "https://image-workshop.casfa.shazhou.me",
    "name": "image-workshop",
    "delegate_token": "pre-issued-long-lived-token"
  }
]'
```

MCP server 侧为 mitsein 签发一个长期有效的 delegate token（权限：`use_mcp`）。

**方案 B：OAuth Client Credentials**

MCP server 支持 OAuth client_credentials grant，mitsein 用 client_id + client_secret 直接获取 token，无需用户参与。

推荐方案 A，简单直接，与现有 delegate 机制一致。

---

## 6. 架构组件

### 6.1 MCPSkillRegistry

替代 `AWPSkillRegistry`，管理 MCP 连接和 skill 发现：

```python
class MCPSkillRegistry:
    """MCP endpoint 注册、session 管理、skill 发现与缓存。"""

    _system_sessions: dict[str, MCPSession]   # key = server name
    _user_sessions: dict[str, dict[str, MCPSession]]  # key = user_id → server name

    async def register_system(self, url: str, token: str, name: str | None = None) -> None:
        """注册系统级 MCP endpoint。"""
        # 1. MCP connect + initialize → 获取 serverInfo.name
        # 2. resources/list → 过滤 skill resources
        # 3. resources/read → 获取 SKILL.md，缓存到 Redis
        # 4. tools/list → 缓存工具 schema
        # 5. 存入 _system_sessions[server_name]

    async def register_user(self, user_id: str, url: str, token: str) -> None:
        """注册用户级 MCP endpoint。"""

    def get_session(self, server_name: str, user_id: str | None = None) -> MCPSession:
        """按 server name 查找 session（先查用户，再查系统）。"""

    async def discover_skills(self, server_name: str) -> list[SkillInfo]:
        """获取指定 endpoint 的 skill 列表。"""

    async def get_skill_content(self, server_name: str, skill_uri: str) -> str:
        """获取 skill 的 SKILL.md 内容（优先 Redis 缓存）。"""

    async def list_all_tools(self, user_id: str | None = None) -> list[ToolSchema]:
        """获取所有 endpoint 的工具（含 server name 前缀）。"""

    async def invalidate_user_cache(self, user_id: str) -> None:
        """gRPC 通知时清除用户缓存。"""
```

### 6.2 MCPToolHandler

替代 `AWPToolHandler`，实现 `DynamicToolHandler` 接口：

```python
class MCPToolHandler:
    """MCP 工具执行器，实现 DynamicToolHandler 接口。"""

    def __init__(self, registry: MCPSkillRegistry, server_name: str):
        self._registry = registry
        self._server_name = server_name

    async def get_dynamic_schemas(self) -> list[dict]:
        """从 MCP tools/list 获取工具 schema，加 server name 前缀。"""
        session = self._registry.get_session(self._server_name)
        tools = await session.list_tools()
        prefix = self._server_name.replace("-", "_")
        return [
            {
                "name": f"{prefix}__{tool.name}",
                "description": tool.description,
                "inputSchema": tool.inputSchema,
            }
            for tool in tools
        ]

    async def execute_tool(self, tool_name: str, arguments: dict) -> str:
        """执行 MCP tool，自动注入 CASFA 上下文。"""
        session = self._registry.get_session(self._server_name)

        # CASFA 注入
        tool_schema = await self._get_tool_schema(tool_name)
        if needs_casfa_injection(tool_schema):
            injector = CasfaContextInjector()
            arguments = await injector.inject(account_id, arguments)

        # MCP tools/call
        result = await session.call_tool(tool_name, arguments)
        return result
```

### 6.3 初始化流程

```python
async def initialize_skills():
    """启动时注册所有系统级 MCP endpoint。"""
    registry = get_mcp_skill_registry()

    # 解析 SYSTEM_MCP_ENDPOINTS 配置
    endpoints = _parse_system_mcp_endpoints()

    for ep in endpoints:
        await registry.register_system(
            url=ep.url,
            token=ep.delegate_token,
            name=ep.name,
        )
        # skill 内容自动缓存到 Redis
```

### 6.4 配置格式

```bash
# .env
SYSTEM_MCP_ENDPOINTS='[
  {
    "url": "https://image-workshop.casfa.shazhou.me",
    "name": "image-workshop",
    "delegate_token": "..."
  }
]'
```

替代现有的 `SYSTEM_AWP_ENDPOINTS`。

---

## 7. 端到端数据流

### 7.1 启动阶段

```
1. initialize_skills()
2. 解析 SYSTEM_MCP_ENDPOINTS
3. 对每个 endpoint:
   a. MCP connect → initialize → serverInfo.name = "image-workshop"
   b. resources/list → 过滤 skill:// resources
   c. resources/read → 解析 SKILL.md → 缓存到 Redis
   d. tools/list → 缓存工具 schema
   e. 注册 MCPToolHandler 到 ToolRegistry
      key = "image_workshop"（server name 下划线化）
```

### 7.2 Agent 执行阶段

```
1. Agent 启动请求
2. SkillContextManager 加载 skill → 从 Redis 读取 SKILL.md
3. 根据 allowed-tools 过滤可用工具
4. LLM 收到工具列表: ["image_workshop__flux_image", ...]
5. LLM 调用 "image_workshop__flux_image"
6. ToolExecutor 分割 → ("image_workshop", "flux_image")
7. 查找 MCPToolHandler(server_name="image-workshop")
8. 检查 inputSchema → 需要 CASFA 注入
9. CasfaContextInjector 创建 delegate token → 注入参数
10. MCP tools/call("flux_image", {prompt, casfaBaseUrl, branchAccessToken, ...})
11. image-workshop 执行 → 生成图片 → 写入 CASFA branch → 返回结果
12. Agent 收到结果，继续对话
```

### 7.3 用户管理 Endpoint

```
1. 用户通过 API 注册 MCP endpoint
   POST /api/mcp-endpoints {url, delegate_token}
2. MCPSkillRegistry.register_user() → 建立 MCP session
3. skill 发现 + Redis 缓存
4. gRPC 通知 agent-service 刷新
5. 下次 agent 请求时，新 endpoint 的 tools 可用
```

---

## 8. 迁移影响

### mitsein 侧删除

| 文件 | 说明 |
|------|------|
| `awp/client.py` | 自定义 JSON-RPC client |
| `awp/protocol.py` | JSON-RPC 方法定义 |
| `awp/blob_processor.py` | S3 presigned URL 交换 |
| `awp/schema_transformer.py` | url→prefix schema 转换 |
| `auth/methods.py` | HMAC / Bearer 自定义 auth |
| `auth/manager.py` | Auth manager 抽象 |
| `utils/hash.py` | XXH3 alias 计算 |

### mitsein 侧新增/重构

| 文件 | 说明 |
|------|------|
| `mcp/registry.py` | `MCPSkillRegistry`（替代 `AWPSkillRegistry`） |
| `mcp/tool_handler.py` | `MCPToolHandler`（替代 `AWPToolHandler`） |
| `mcp/casfa_injector.py` | `CasfaContextInjector`（从 `CasfaBlobProcessor` 重构） |
| `initialization.py` | 更新启动流程（`SYSTEM_MCP_ENDPOINTS`） |

### mitsein 侧修改

| 文件 | 改动 |
|------|------|
| `mitsein_config/config.py` | `SYSTEM_AWP_ENDPOINTS` → `SYSTEM_MCP_ENDPOINTS`，删除 `AWP_BLOB_*` 配置 |
| `registry/awp.py` | 重写为 `mcp/registry.py` |
| `tool_handler.py` | 重写为 `mcp/tool_handler.py` |
| `routes/awp_endpoints.py` | 重命名为 `routes/mcp_endpoints.py`，API 路径 `/api/awp-endpoints` → `/api/mcp-endpoints` |
| `agentpress/tool_executor.py` | alias 路由逻辑：hash alias → server name 前缀 |
| 前端 hooks | `useSkills()` 等 API 路径更新 |

### image-workshop 侧新增

| 改动 | 说明 |
|------|------|
| 注册 skill resource | `resources/list` + `resources/read` 暴露 SKILL.md |
| SKILL.md 文件 | 创建 skill 描述文件 |
