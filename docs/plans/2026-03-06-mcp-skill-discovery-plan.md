# MCP Skill Discovery 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 废弃自定义 AWP 协议，全面采用标准 MCP 协议实现 skill 发现、工具调用和 CASFA 上下文注入。

**Architecture:** MCP server（image-workshop）通过 `resources` 暴露 skill 描述，mitsein 作为 MCP client 通过标准 `resources/list` + `resources/read` 发现 skills，通过 `tools/list` + `tools/call` 发现和调用工具。工具名使用 MCP server name 作为可读前缀（替代 hash alias）。CASFA 上下文通过 `CasfaContextInjector` 在 `tools/call` 前自动注入。认证走 MCP 标准 OAuth / delegate token。

**Tech Stack:** Python MCP SDK (`mcp>=1.25.0`)、TypeScript MCP SDK (`@modelcontextprotocol/sdk@1.27.1`)、Redis（skill 缓存）

**Design Doc:** `docs/plans/2026-03-06-mcp-skill-discovery-design.md`

**涉及两个仓库：**
- `casfa` — image-workshop MCP server 侧（注册 skill resource）
- `mitsein` — MCP client 侧（skill 发现、工具调用、配置迁移）

---

## Phase 1: image-workshop 注册 Skill Resource（casfa 仓库）

### Task 1: 创建 SKILL.md 并注册为 MCP Resource

**仓库：** `casfa`

**Files:**
- Create: `apps/image-workshop/backend/skills/flux-image-gen.md`
- Modify: `apps/image-workshop/backend/index.ts`

**Step 1: 创建 SKILL.md 文件**

```markdown
---
name: "FLUX Image Generation"
description: "Generate images from text prompts using BFL FLUX"
version: "1.0.0"
category: "image"
author: "casfa"
allowed-tools: ["flux_image"]
---

# FLUX Image Generation

Generate high-quality images from text prompts using the BFL FLUX model.

## Usage

Provide a text prompt describing the desired image. The tool will:
1. Generate the image via BFL FLUX API
2. Upload the result to the specified CASFA branch
3. Complete the branch (merge back to parent)

## Parameters

- **prompt** (required): Text description of the desired image
- **filename** (required): Output filename (e.g. "output.png")
- **width/height** (optional): Output dimensions in pixels (64-2048, default 1024)
- **seed** (optional): Seed for reproducible results
- **output_format** (optional): "jpeg" or "png" (default "jpeg")
```

**Step 2: 在 `createMcpServer()` 中注册 skill resource**

修改 `apps/image-workshop/backend/index.ts`，在 `server.registerTool()` 之前添加：

```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 读取 SKILL.md
const __dirname = dirname(fileURLToPath(import.meta.url));
const fluxSkillContent = readFileSync(
  resolve(__dirname, "skills/flux-image-gen.md"),
  "utf-8"
);

// 在 createMcpServer() 中，server.registerTool() 之前：
server.registerResource(
  "FLUX Image Generation",
  "skill://flux-image-gen",
  {
    description: "Skill descriptor for FLUX image generation",
    mimeType: "text/markdown",
    annotations: { audience: ["assistant"], priority: 1 },
  },
  async () => ({
    contents: [
      {
        uri: "skill://flux-image-gen",
        mimeType: "text/markdown",
        text: fluxSkillContent,
      },
    ],
  })
);
```

注意：MCP `Annotations` 类型只支持 `audience`、`priority`、`lastModified`。`type: "skill"` 需要通过 `_meta` 字段或依赖 `skill://` URI scheme 识别。更新识别策略为：**仅通过 URI scheme `skill://` 识别**。

**Step 3: 运行测试验证**

Run: `cd /Users/yanjiayi/workspace/casfa/apps/image-workshop && bun test`
Expected: PASS（现有测试不受影响）

**Step 4: 本地验证 resource 注册**

启动 image-workshop 并测试 resources/list：

Run: `cd /Users/yanjiayi/workspace/casfa/apps/image-workshop && bun run dev`

在另一个终端，用 curl 验证（需先获取 OAuth token 或用 mock auth）：

```bash
curl -s http://localhost:7201/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list","params":{}}' | jq .
```

Expected: 返回包含 `skill://flux-image-gen` 的 resource 列表。

**Step 5: Commit**

```bash
cd /Users/yanjiayi/workspace/casfa
git add apps/image-workshop/backend/skills/flux-image-gen.md apps/image-workshop/backend/index.ts
git commit -m "feat(image-workshop): register skill as MCP resource"
```

---

## Phase 2: mitsein — 新建 MCP 模块（mitsein 仓库）

### Task 2: 创建 MCPSkillRegistry

**仓库：** `mitsein`

**Files:**
- Create: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/__init__.py`
- Create: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/registry.py`
- Create: `backend/packages/mitsein-skills-registry/tests/test_mcp_registry.py`

**Step 1: 创建 `mcp/__init__.py`**

```python
"""MCP-based skill discovery and tool execution."""

from .registry import MCPSkillRegistry

__all__ = ["MCPSkillRegistry"]
```

**Step 2: 写 MCPSkillRegistry 的 failing test**

```python
# tests/test_mcp_registry.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from mitsein_skills_registry.mcp.registry import MCPSkillRegistry, MCPEndpointInfo


class TestMCPSkillRegistry:
    @pytest.fixture
    def registry(self):
        return MCPSkillRegistry()

    @pytest.mark.asyncio
    async def test_register_system_stores_session(self, registry):
        """Registering a system endpoint stores it by server name."""
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock(return_value=MagicMock(
            serverInfo=MagicMock(name="image-workshop", version="0.1.0")
        ))
        mock_session.list_resources = AsyncMock(return_value=MagicMock(resources=[]))
        mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[]))

        with patch(
            "mitsein_skills_registry.mcp.registry.create_mcp_session",
            new_callable=AsyncMock,
            return_value=mock_session,
        ):
            await registry.register_system(
                url="https://image-workshop.casfa.shazhou.me/mcp",
                token="test-token",
            )

        info = registry.get_endpoint_info("image-workshop")
        assert info is not None
        assert info.server_name == "image-workshop"
        assert info.url == "https://image-workshop.casfa.shazhou.me/mcp"

    @pytest.mark.asyncio
    async def test_get_session_returns_none_for_unknown(self, registry):
        """get_endpoint_info returns None for unknown server name."""
        assert registry.get_endpoint_info("unknown") is None

    @pytest.mark.asyncio
    async def test_discover_skills_filters_by_uri_scheme(self, registry):
        """discover_skills only returns resources with skill:// URI."""
        mock_resource_skill = MagicMock(
            uri="skill://flux-image-gen",
            name="FLUX Image Generation",
            mimeType="text/markdown",
        )
        mock_resource_other = MagicMock(
            uri="file://readme.md",
            name="README",
            mimeType="text/markdown",
        )
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock(return_value=MagicMock(
            serverInfo=MagicMock(name="image-workshop", version="0.1.0")
        ))
        mock_session.list_resources = AsyncMock(return_value=MagicMock(
            resources=[mock_resource_skill, mock_resource_other]
        ))
        mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[]))
        mock_session.read_resource = AsyncMock(return_value=MagicMock(
            contents=[MagicMock(text="---\nname: FLUX\nallowed-tools: [flux_image]\n---\n# FLUX")]
        ))

        with patch(
            "mitsein_skills_registry.mcp.registry.create_mcp_session",
            new_callable=AsyncMock,
            return_value=mock_session,
        ):
            await registry.register_system(
                url="https://example.com/mcp",
                token="test-token",
            )

        skills = await registry.discover_skills("image-workshop")
        assert len(skills) == 1
        assert skills[0].uri == "skill://flux-image-gen"

    @pytest.mark.asyncio
    async def test_list_all_tools_adds_server_name_prefix(self, registry):
        """list_all_tools prefixes tool names with server name."""
        mock_tool = MagicMock(
            name="flux_image",
            description="Generate image",
            inputSchema={"type": "object", "properties": {}},
        )
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock(return_value=MagicMock(
            serverInfo=MagicMock(name="image-workshop", version="0.1.0")
        ))
        mock_session.list_resources = AsyncMock(return_value=MagicMock(resources=[]))
        mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[mock_tool]))

        with patch(
            "mitsein_skills_registry.mcp.registry.create_mcp_session",
            new_callable=AsyncMock,
            return_value=mock_session,
        ):
            await registry.register_system(
                url="https://example.com/mcp",
                token="test-token",
            )

        tools = await registry.list_all_tools()
        assert len(tools) == 1
        assert tools[0]["name"] == "image_workshop__flux_image"
```

**Step 3: 运行测试确认失败**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_mcp_registry.py -v`
Expected: FAIL — `MCPSkillRegistry` 不存在

**Step 4: 实现 MCPSkillRegistry**

```python
# mitsein_skills_registry/mcp/registry.py
"""MCPSkillRegistry — MCP endpoint 注册、session 管理、skill 发现与缓存。"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from mitsein_util_log import logger


@dataclass
class SkillResourceInfo:
    """Skill resource metadata from resources/list."""

    uri: str
    name: str
    mime_type: str


@dataclass
class MCPEndpointInfo:
    """Registered MCP endpoint info."""

    url: str
    server_name: str
    server_version: str
    token: str
    skill_resources: list[SkillResourceInfo] = field(default_factory=list)
    tool_schemas: list[dict] = field(default_factory=list)


async def create_mcp_session(url: str, token: str) -> ClientSession:
    """Create and initialize an MCP ClientSession with Bearer auth."""
    headers = {"Authorization": f"Bearer {token}"}
    timeout = httpx.Timeout(30.0, read=300.0)
    http_client = httpx.AsyncClient(headers=headers, timeout=timeout)

    read_stream, write_stream, _ = await streamable_http_client(
        url, http_client=http_client
    ).__aenter__()

    session = ClientSession(read_stream, write_stream)
    await session.__aenter__()
    await session.initialize()
    return session


class MCPSkillRegistry:
    """MCP endpoint 注册、session 管理、skill 发现与缓存。"""

    def __init__(self) -> None:
        self._system_endpoints: dict[str, MCPEndpointInfo] = {}
        self._system_sessions: dict[str, ClientSession] = {}
        self._user_endpoints: dict[str, dict[str, MCPEndpointInfo]] = {}
        self._user_sessions: dict[str, dict[str, ClientSession]] = {}

    async def register_system(
        self,
        url: str,
        token: str,
        name: str | None = None,
    ) -> MCPEndpointInfo:
        """注册系统级 MCP endpoint。

        连接 MCP server，发现 skills 和 tools，缓存到内存。
        """
        session = await create_mcp_session(url, token)
        init_result = await session.initialize()
        server_name = name or init_result.serverInfo.name

        # 发现 skill resources
        resources_result = await session.list_resources()
        skill_resources = [
            SkillResourceInfo(
                uri=str(r.uri),
                name=r.name,
                mime_type=r.mimeType or "text/markdown",
            )
            for r in resources_result.resources
            if str(r.uri).startswith("skill://")
        ]

        # 发现 tools
        tools_result = await session.list_tools()
        prefix = server_name.replace("-", "_")
        tool_schemas = [
            {
                "name": f"{prefix}__{t.name}",
                "description": t.description or "",
                "inputSchema": t.inputSchema,
            }
            for t in tools_result.tools
        ]

        info = MCPEndpointInfo(
            url=url,
            server_name=server_name,
            server_version=init_result.serverInfo.version or "0.0.0",
            token=token,
            skill_resources=skill_resources,
            tool_schemas=tool_schemas,
        )

        self._system_endpoints[server_name] = info
        self._system_sessions[server_name] = session

        logger.info(
            "MCPSkillRegistry: system endpoint registered",
            server_name=server_name,
            skills=len(skill_resources),
            tools=len(tool_schemas),
        )

        return info

    def get_endpoint_info(
        self, server_name: str, user_id: str | None = None
    ) -> MCPEndpointInfo | None:
        """按 server name 查找 endpoint info（先查用户，再查系统）。"""
        if user_id and user_id in self._user_endpoints:
            if server_name in self._user_endpoints[user_id]:
                return self._user_endpoints[user_id][server_name]
        return self._system_endpoints.get(server_name)

    def get_session(
        self, server_name: str, user_id: str | None = None
    ) -> ClientSession | None:
        """按 server name 查找 MCP session。"""
        if user_id and user_id in self._user_sessions:
            if server_name in self._user_sessions[user_id]:
                return self._user_sessions[user_id][server_name]
        return self._system_sessions.get(server_name)

    async def discover_skills(
        self, server_name: str, user_id: str | None = None
    ) -> list[SkillResourceInfo]:
        """获取指定 endpoint 的 skill 列表。"""
        info = self.get_endpoint_info(server_name, user_id)
        if not info:
            return []
        return info.skill_resources

    async def get_skill_content(
        self, server_name: str, skill_uri: str, user_id: str | None = None
    ) -> str | None:
        """读取 skill 的 SKILL.md 内容。"""
        session = self.get_session(server_name, user_id)
        if not session:
            return None
        try:
            result = await session.read_resource(skill_uri)
            if result.contents:
                return result.contents[0].text
        except Exception as e:
            logger.error(
                "MCPSkillRegistry: failed to read skill resource",
                server_name=server_name,
                skill_uri=skill_uri,
                error=str(e),
            )
        return None

    async def list_all_tools(
        self, user_id: str | None = None
    ) -> list[dict]:
        """获取所有 endpoint 的工具 schema（含 server name 前缀）。"""
        all_tools: list[dict] = []
        for info in self._system_endpoints.values():
            all_tools.extend(info.tool_schemas)
        if user_id and user_id in self._user_endpoints:
            for info in self._user_endpoints[user_id].values():
                all_tools.extend(info.tool_schemas)
        return all_tools

    def get_system_endpoints(self) -> list[MCPEndpointInfo]:
        """返回所有系统级 endpoint。"""
        return list(self._system_endpoints.values())

    async def invalidate_user_cache(self, user_id: str) -> None:
        """gRPC 通知时清除用户缓存。"""
        if user_id in self._user_sessions:
            for session in self._user_sessions[user_id].values():
                try:
                    await session.__aexit__(None, None, None)
                except Exception:
                    pass
            del self._user_sessions[user_id]
        self._user_endpoints.pop(user_id, None)
```

**Step 5: 运行测试确认通过**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_mcp_registry.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/
git add backend/packages/mitsein-skills-registry/tests/test_mcp_registry.py
git commit -m "feat(skills): add MCPSkillRegistry with skill discovery via MCP resources"
```

---

### Task 3: 创建 MCPToolHandler

**仓库：** `mitsein`

**Files:**
- Create: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/tool_handler.py`
- Create: `backend/packages/mitsein-skills-registry/tests/test_mcp_tool_handler.py`

**Step 1: 写 failing test**

```python
# tests/test_mcp_tool_handler.py
import pytest
from unittest.mock import AsyncMock, MagicMock

from mitsein_skills_registry.mcp.tool_handler import MCPToolHandler


class TestMCPToolHandler:
    @pytest.fixture
    def mock_registry(self):
        registry = MagicMock()
        mock_session = MagicMock()
        mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[
            MagicMock(
                name="flux_image",
                description="Generate image",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string"},
                        "casfaBaseUrl": {"type": "string"},
                        "branchAccessToken": {"type": "string"},
                    },
                    "required": ["prompt", "casfaBaseUrl", "branchAccessToken"],
                },
            )
        ]))
        mock_session.call_tool = AsyncMock(return_value=MagicMock(
            content=[MagicMock(type="text", text='{"success": true}')],
            isError=False,
        ))
        registry.get_session.return_value = mock_session
        return registry

    @pytest.fixture
    def handler(self, mock_registry):
        return MCPToolHandler(registry=mock_registry, server_name="image-workshop")

    @pytest.mark.asyncio
    async def test_get_dynamic_schemas_adds_prefix(self, handler):
        schemas = await handler.get_dynamic_schemas()
        assert len(schemas) == 1
        assert schemas[0]["name"] == "image_workshop__flux_image"

    @pytest.mark.asyncio
    async def test_execute_tool_calls_mcp_session(self, handler, mock_registry):
        result = await handler.execute_tool(
            "flux_image",
            {"prompt": "a cat", "casfaBaseUrl": "x", "branchAccessToken": "y"},
        )
        mock_registry.get_session.return_value.call_tool.assert_called_once()
        assert "success" in result
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_mcp_tool_handler.py -v`
Expected: FAIL

**Step 3: 实现 MCPToolHandler**

```python
# mitsein_skills_registry/mcp/tool_handler.py
"""MCPToolHandler — MCP 工具执行器，实现 DynamicToolHandler 接口。"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from mitsein_util_log import logger

if TYPE_CHECKING:
    from .registry import MCPSkillRegistry


class MCPToolHandler:
    """MCP 工具执行器。

    通过 MCP tools/list 获取 schema，通过 tools/call 执行工具。
    """

    def __init__(self, registry: MCPSkillRegistry, server_name: str) -> None:
        self._registry = registry
        self._server_name = server_name
        self._prefix = server_name.replace("-", "_")

    async def get_dynamic_schemas(self) -> list[dict]:
        """从 MCP tools/list 获取工具 schema，加 server name 前缀。"""
        session = self._registry.get_session(self._server_name)
        if not session:
            return []

        result = await session.list_tools()
        return [
            {
                "name": f"{self._prefix}__{tool.name}",
                "description": tool.description or "",
                "inputSchema": tool.inputSchema,
            }
            for tool in result.tools
        ]

    async def execute_tool(self, tool_name: str, arguments: dict) -> str:
        """执行 MCP tool。

        Args:
            tool_name: 不含前缀的原始 tool 名（如 "flux_image"）。
            arguments: 工具参数。

        Returns:
            工具执行结果的 JSON 字符串。
        """
        session = self._registry.get_session(self._server_name)
        if not session:
            return json.dumps({"error": f"No MCP session for {self._server_name}"})

        try:
            result = await session.call_tool(tool_name, arguments)

            if result.isError:
                error_text = ""
                for content in result.content:
                    if hasattr(content, "text"):
                        error_text += content.text
                logger.error(
                    "MCPToolHandler: tool returned error",
                    server_name=self._server_name,
                    tool_name=tool_name,
                    error=error_text,
                )
                return json.dumps({"error": error_text})

            # 提取 text content
            texts = []
            for content in result.content:
                if hasattr(content, "text"):
                    texts.append(content.text)

            return "\n".join(texts) if texts else json.dumps({"success": True})

        except Exception as e:
            logger.error(
                "MCPToolHandler: tool execution failed",
                server_name=self._server_name,
                tool_name=tool_name,
                error=str(e),
            )
            return json.dumps({"error": str(e)})
```

**Step 4: 运行测试确认通过**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_mcp_tool_handler.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/tool_handler.py
git add backend/packages/mitsein-skills-registry/tests/test_mcp_tool_handler.py
git commit -m "feat(skills): add MCPToolHandler for MCP tool execution"
```

---

### Task 4: 创建 CasfaContextInjector

**仓库：** `mitsein`

**Files:**
- Create: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/casfa_injector.py`
- Create: `backend/packages/mitsein-skills-registry/tests/test_casfa_injector.py`

**Step 1: 写 failing test**

```python
# tests/test_casfa_injector.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from mitsein_skills_registry.mcp.casfa_injector import (
    CasfaContextInjector,
    needs_casfa_injection,
)


class TestNeedsCasfaInjection:
    def test_returns_true_when_both_params_present(self):
        schema = {
            "inputSchema": {
                "properties": {
                    "prompt": {"type": "string"},
                    "casfaBaseUrl": {"type": "string"},
                    "branchAccessToken": {"type": "string"},
                }
            }
        }
        assert needs_casfa_injection(schema) is True

    def test_returns_false_when_params_missing(self):
        schema = {
            "inputSchema": {
                "properties": {
                    "prompt": {"type": "string"},
                }
            }
        }
        assert needs_casfa_injection(schema) is False


class TestCasfaContextInjector:
    @pytest.mark.asyncio
    async def test_inject_adds_casfa_params(self):
        mock_delegate = MagicMock(
            endpoint="https://casfa.example.com",
            access_token_id="tok_123",
            access_token_base64="base64token",
        )

        with patch(
            "mitsein_skills_registry.mcp.casfa_injector.create_delegate_token",
            new_callable=AsyncMock,
            return_value=mock_delegate,
        ):
            injector = CasfaContextInjector()
            result = await injector.inject(
                account_id="acc_001",
                arguments={"prompt": "a cat"},
            )

        assert result["prompt"] == "a cat"
        assert result["casfaBaseUrl"] == "https://casfa.example.com"
        assert result["branchAccessToken"] == "tok_123:base64token"

    @pytest.mark.asyncio
    async def test_inject_returns_original_when_delegate_fails(self):
        with patch(
            "mitsein_skills_registry.mcp.casfa_injector.create_delegate_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            injector = CasfaContextInjector()
            result = await injector.inject(
                account_id="acc_001",
                arguments={"prompt": "a cat"},
            )

        assert result == {"prompt": "a cat"}
        assert "casfaBaseUrl" not in result
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_casfa_injector.py -v`
Expected: FAIL

**Step 3: 实现 CasfaContextInjector**

```python
# mitsein_skills_registry/mcp/casfa_injector.py
"""CasfaContextInjector — 在 MCP tools/call 前注入 CASFA branch 上下文。"""

from __future__ import annotations

from mitsein_fs.casfa_delegate_helper import create_delegate_token
from mitsein_util_log import logger


def needs_casfa_injection(tool_schema: dict) -> bool:
    """检查 tool 的 inputSchema 是否需要 CASFA 注入。"""
    props = tool_schema.get("inputSchema", {}).get("properties", {})
    return "casfaBaseUrl" in props and "branchAccessToken" in props


class CasfaContextInjector:
    """在 MCP tools/call 前创建 CASFA delegate token 并注入参数。"""

    async def inject(
        self,
        account_id: str,
        arguments: dict,
    ) -> dict:
        """创建 CASFA delegate token 并注入到 tool 参数。

        如果 delegate token 创建失败，返回原始参数（不注入）。
        """
        delegate = await create_delegate_token(account_id, can_upload=True)
        if not delegate:
            logger.warning(
                "CasfaContextInjector: delegate token creation failed, skipping injection",
                account_id=account_id,
            )
            return arguments

        enriched = {**arguments}
        enriched["casfaBaseUrl"] = delegate.endpoint
        enriched["branchAccessToken"] = (
            f"{delegate.access_token_id}:{delegate.access_token_base64}"
        )

        logger.info(
            "CasfaContextInjector: injected CASFA context",
            account_id=account_id,
            endpoint=delegate.endpoint,
        )
        return enriched
```

**Step 4: 运行测试确认通过**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_casfa_injector.py -v`
Expected: PASS

**Step 5: 更新 `mcp/__init__.py` 导出**

```python
"""MCP-based skill discovery and tool execution."""

from .casfa_injector import CasfaContextInjector, needs_casfa_injection
from .registry import MCPSkillRegistry
from .tool_handler import MCPToolHandler

__all__ = [
    "CasfaContextInjector",
    "MCPSkillRegistry",
    "MCPToolHandler",
    "needs_casfa_injection",
]
```

**Step 6: Commit**

```bash
git add backend/packages/mitsein-skills-registry/mitsein_skills_registry/mcp/
git add backend/packages/mitsein-skills-registry/tests/test_casfa_injector.py
git commit -m "feat(skills): add CasfaContextInjector for MCP tool CASFA injection"
```

---

## Phase 3: mitsein — 配置迁移

### Task 5: 更新配置 SYSTEM_AWP_ENDPOINTS → SYSTEM_MCP_ENDPOINTS

**仓库：** `mitsein`

**Files:**
- Modify: `backend/packages/mitsein-config/mitsein_config/config.py:130-134,386-398`

**Step 1: 修改 config.py**

在 `config.py` 中：

1. 将 `SYSTEM_AWP_ENDPOINTS`（line 130-134）重命名为 `SYSTEM_MCP_ENDPOINTS`，更新注释：

```python
# MCP Endpoints (replaces SYSTEM_AWP_ENDPOINTS)
# JSON array of MCP server configs:
# [{"url": "https://example.com/mcp", "name": "image-workshop", "delegate_token": "..."}]
SYSTEM_MCP_ENDPOINTS: str | None = None
```

2. 删除 `AWP_BLOB_*` 配置（lines 386-398）：
   - `AWP_BLOB_BUCKET_NAME`
   - `AWP_BLOB_PREFIX`
   - `AWP_BLOB_URL_EXPIRY_HOURS`
   - `AWP_BLOB_MODE`

**Step 2: 全局搜索确认无遗漏引用**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && grep -r "SYSTEM_AWP_ENDPOINTS\|AWP_BLOB_" --include="*.py" | grep -v __pycache__ | grep -v test`

记录所有引用位置，后续 task 逐一更新。

**Step 3: Commit**

```bash
git add backend/packages/mitsein-config/mitsein_config/config.py
git commit -m "refactor(config): rename SYSTEM_AWP_ENDPOINTS to SYSTEM_MCP_ENDPOINTS, remove AWP_BLOB_*"
```

---

### Task 6: 重写 initialization.py

**仓库：** `mitsein`

**Files:**
- Modify: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/initialization.py`
- Create: `backend/packages/mitsein-skills-registry/tests/test_initialization_mcp.py`

**Step 1: 写 failing test**

```python
# tests/test_initialization_mcp.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import json


class TestParseSystemMcpEndpoints:
    def test_parses_valid_json(self):
        from mitsein_skills_registry.initialization import _parse_system_mcp_endpoints

        with patch("mitsein_skills_registry.initialization.config") as mock_config:
            mock_config.SYSTEM_MCP_ENDPOINTS = json.dumps([
                {
                    "url": "https://example.com/mcp",
                    "name": "image-workshop",
                    "delegate_token": "test-token",
                }
            ])
            endpoints = _parse_system_mcp_endpoints()
            assert len(endpoints) == 1
            assert endpoints[0]["url"] == "https://example.com/mcp"
            assert endpoints[0]["name"] == "image-workshop"

    def test_returns_empty_when_none(self):
        from mitsein_skills_registry.initialization import _parse_system_mcp_endpoints

        with patch("mitsein_skills_registry.initialization.config") as mock_config:
            mock_config.SYSTEM_MCP_ENDPOINTS = None
            endpoints = _parse_system_mcp_endpoints()
            assert endpoints == []


class TestRegisterSystemMcp:
    @pytest.mark.asyncio
    async def test_registers_endpoint_with_registry(self):
        from mitsein_skills_registry.initialization import register_system_mcp

        mock_registry = MagicMock()
        mock_registry.register_system = AsyncMock(return_value=MagicMock(
            server_name="image-workshop",
            skill_resources=[],
        ))

        with patch(
            "mitsein_skills_registry.initialization.get_mcp_skill_registry",
            return_value=mock_registry,
        ):
            await register_system_mcp(
                endpoint_url="https://example.com/mcp",
                delegate_token="test-token",
                name="image-workshop",
            )

        mock_registry.register_system.assert_called_once_with(
            url="https://example.com/mcp",
            token="test-token",
            name="image-workshop",
        )
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_initialization_mcp.py -v`
Expected: FAIL

**Step 3: 重写 initialization.py 的关键函数**

替换 `_parse_system_awp_endpoints()` → `_parse_system_mcp_endpoints()`：

```python
def _parse_system_mcp_endpoints() -> list[dict]:
    """解析 SYSTEM_MCP_ENDPOINTS JSON 配置。"""
    raw = config.SYSTEM_MCP_ENDPOINTS
    if not raw:
        return []
    try:
        endpoints = json.loads(raw)
        if not isinstance(endpoints, list):
            logger.error("SYSTEM_MCP_ENDPOINTS: expected JSON array")
            return []
        return endpoints
    except json.JSONDecodeError as e:
        logger.error("SYSTEM_MCP_ENDPOINTS: invalid JSON", error=str(e))
        return []
```

替换 `register_system_awp()` → `register_system_mcp()`：

```python
async def register_system_mcp(
    endpoint_url: str,
    delegate_token: str,
    name: str | None = None,
) -> None:
    """注册系统级 MCP endpoint。"""
    registry = get_mcp_skill_registry()
    info = await registry.register_system(
        url=endpoint_url,
        token=delegate_token,
        name=name,
    )
    # 预加载 skill 内容到 Redis
    skill_cache = SkillContentCache()
    for skill in info.skill_resources:
        content = await registry.get_skill_content(info.server_name, skill.uri)
        if content:
            await skill_cache.store_content(skill.name, content)
    logger.info(
        "register_system_mcp: completed",
        server_name=info.server_name,
        skills_cached=len(info.skill_resources),
    )
```

更新 `initialize_skills()` 中的 AWP 部分，替换为 MCP：

```python
# 在 initialize_skills() 中替换 AWP endpoint 注册逻辑
mcp_endpoints = _parse_system_mcp_endpoints()
for ep in mcp_endpoints:
    try:
        await register_system_mcp(
            endpoint_url=ep["url"],
            delegate_token=ep.get("delegate_token", ""),
            name=ep.get("name"),
        )
    except Exception as e:
        logger.error(
            "initialize_skills: failed to register MCP endpoint",
            url=ep.get("url"),
            error=str(e),
        )
```

添加 singleton：

```python
_mcp_skill_registry: MCPSkillRegistry | None = None

def get_mcp_skill_registry() -> MCPSkillRegistry:
    global _mcp_skill_registry
    if _mcp_skill_registry is None:
        _mcp_skill_registry = MCPSkillRegistry()
    return _mcp_skill_registry
```

**Step 4: 运行测试确认通过**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/test_initialization_mcp.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/packages/mitsein-skills-registry/mitsein_skills_registry/initialization.py
git add backend/packages/mitsein-skills-registry/tests/test_initialization_mcp.py
git commit -m "refactor(skills): replace AWP initialization with MCP endpoint registration"
```

---

## Phase 4: mitsein — 路由和上游对接

### Task 7: 更新 ToolExecutor 路由逻辑

**仓库：** `mitsein`

**Files:**
- Modify: `backend/packages/mitsein-base-core/mitsein_base_core/agentpress/tool_executor.py:121-146`

**Step 1: 更新 alias 路由注释**

路由逻辑本身不需要大改（仍然按 `__` 分割），但注释和变量名从 "alias" 改为 "server_prefix"：

```python
# Line 121-146 区域，更新变量名和注释：
# Before: alias, tool_name = function_name.split("__", 1)
# After:  server_prefix, tool_name = function_name.split("__", 1)
```

实际路由机制不变，因为 `ToolRegistry.register_dynamic_tool_handler()` 的 key 从 hash alias 变为 server name prefix（如 `"image_workshop"`），但接口保持不变。

**Step 2: 运行现有测试**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-base-core/tests/ -v -k tool_executor`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/packages/mitsein-base-core/mitsein_base_core/agentpress/tool_executor.py
git commit -m "refactor(tool-executor): rename alias to server_prefix in routing comments"
```

---

### Task 8: 更新 SkillContextManager

**仓库：** `mitsein`

**Files:**
- Modify: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/context/manager.py:263-308`

**Step 1: 将 `_register_awp_handler` 改为 `_register_mcp_handler`**

```python
async def _register_mcp_handler(self, server_name: str) -> None:
    """为 MCP endpoint 注册 MCPToolHandler 到 tool registry。"""
    from mitsein_skills_registry.mcp.tool_handler import MCPToolHandler
    from mitsein_skills_registry.initialization import get_mcp_skill_registry

    registry = get_mcp_skill_registry()
    session = registry.get_session(server_name)
    if not session:
        logger.warning(
            "SkillContextManager: no MCP session for server",
            server_name=server_name,
        )
        return

    prefix = server_name.replace("-", "_")
    handler = MCPToolHandler(registry=registry, server_name=server_name)
    self._tool_registry.register_dynamic_tool_handler(prefix, handler)

    logger.info(
        "SkillContextManager: MCP handler registered",
        server_name=server_name,
        prefix=prefix,
    )
```

更新 `_load_skill_internal()` 中的调用：从 `_register_awp_handler(alias)` 改为 `_register_mcp_handler(server_name)`。

**Step 2: 运行测试**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/ -v`
Expected: PASS（部分测试可能需要更新 mock）

**Step 3: Commit**

```bash
git add backend/packages/mitsein-skills-registry/mitsein_skills_registry/context/manager.py
git commit -m "refactor(skills): replace _register_awp_handler with _register_mcp_handler"
```

---

### Task 9: 更新 API 路由 awp_endpoints → mcp_endpoints

**仓库：** `mitsein`

**Files:**
- Rename: `backend/apps/mitsein-api-service/routes/awp_endpoints.py` → `mcp_endpoints.py`
- Modify: `backend/apps/mitsein-api-service/api.py`（更新 import 和路由注册）

**Step 1: 重命名文件**

```bash
git mv backend/apps/mitsein-api-service/routes/awp_endpoints.py \
       backend/apps/mitsein-api-service/routes/mcp_endpoints.py
```

**Step 2: 更新路由文件内部**

- API 路径 `/api/awp-endpoints` → `/api/mcp-endpoints`
- 函数名 `register_awp_endpoint` → `register_mcp_endpoint` 等
- 内部调用从 `AWPSkillRegistry` 改为 `MCPSkillRegistry`

**Step 3: 更新 api.py import**

```python
# Before:
from routes.awp_endpoints import router as awp_endpoints_router
# After:
from routes.mcp_endpoints import router as mcp_endpoints_router
```

**Step 4: 运行测试**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest apps/mitsein-api-service/tests/ -v`
Expected: PASS（路由测试可能需要更新 path）

**Step 5: Commit**

```bash
git add backend/apps/mitsein-api-service/routes/mcp_endpoints.py
git add backend/apps/mitsein-api-service/api.py
git commit -m "refactor(api): rename awp-endpoints to mcp-endpoints"
```

---

## Phase 5: 清理 AWP 代码

### Task 10: 删除 AWP 模块

**仓库：** `mitsein`

**Files:**
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/client.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/protocol.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/blob_processor.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/schema_transformer.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/blob_storage.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/casfa_blob_processor.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/auth/methods.py`
- Delete: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/auth/manager.py`
- Modify: `backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/__init__.py`
- Delete: 相关测试文件

**Step 1: 确认无残留引用**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && grep -r "AWPClient\|AWPBlobProcessor\|AWPSchemaTransformer\|HMACAuth\|BearerAuth\|from.*awp.client\|from.*awp.protocol\|from.*awp.blob_processor\|from.*awp.schema_transformer\|from.*auth.methods\|from.*auth.manager" --include="*.py" | grep -v __pycache__ | grep -v test`

确保只剩测试文件和即将删除的文件有引用。

**Step 2: 删除文件**

```bash
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/client.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/protocol.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/blob_processor.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/schema_transformer.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/blob_storage.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/awp/casfa_blob_processor.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/auth/methods.py
git rm backend/packages/mitsein-skills-registry/mitsein_skills_registry/auth/manager.py
```

**Step 3: 更新 `awp/__init__.py`**

只保留仍需要的导出（如 `skill_cache.py`、`sandbox_accessor.py`），删除 AWP 特有的导出。

**Step 4: 删除相关测试文件**

```bash
git rm backend/packages/mitsein-skills-registry/tests/test_awp_blob.py
git rm backend/packages/mitsein-skills-registry/tests/test_casfa_blob_processor.py
git rm backend/packages/mitsein-skills-registry/tests/test_tool_handler_dual_mode.py
# 删除其他 AWP 相关测试
```

**Step 5: 更新 pyproject.toml 依赖**

从 `mitsein-skills-registry/pyproject.toml` 中移除不再需要的依赖：
- `xxhash` — hash alias 不再需要
- `mitsein-storage-s3` — S3 blob processor 不再需要

添加新依赖：
- `mcp>=1.25.0` — MCP SDK

**Step 6: 运行全部测试**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/ -v`
Expected: PASS（所有保留的测试通过）

**Step 7: Commit**

```bash
git add -A backend/packages/mitsein-skills-registry/
git commit -m "refactor(skills): remove AWP protocol code, keep MCP implementation"
```

---

## Phase 6: 全量验证

### Task 11: 端到端验证

**仓库：** `mitsein` + `casfa`

**Step 1: 运行 mitsein 后端 lint**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run ruff check . && uv run ruff format --check .`
Expected: PASS

**Step 2: 运行 mitsein 后端测试**

Run: `cd /Users/yanjiayi/workspace/mitsein/backend && uv run pytest packages/mitsein-skills-registry/tests/ -v`
Expected: ALL PASS

**Step 3: 运行 casfa image-workshop 测试**

Run: `cd /Users/yanjiayi/workspace/casfa/apps/image-workshop && bun test`
Expected: ALL PASS

**Step 4: 搜索残留 AWP 引用**

Run:
```bash
cd /Users/yanjiayi/workspace/mitsein/backend
grep -r "AWPClient\|AWPBlobProcessor\|AWPSchemaTransformer\|SYSTEM_AWP_ENDPOINTS\|AWP_BLOB_\|awp_endpoints\|skills/list" \
  --include="*.py" | grep -v __pycache__ | grep -v test | grep -v ".pyc"
```
Expected: 无匹配（生产代码中无 AWP 残留）

**Step 5: Commit any final fixes**

```bash
git commit -m "chore: final cleanup of AWP references"
```

---

## Summary

| Phase | Tasks | Scope |
|-------|-------|-------|
| Phase 1 | Task 1 | casfa: image-workshop 注册 skill resource |
| Phase 2 | Tasks 2-4 | mitsein: 新建 MCP 模块（Registry, Handler, Injector） |
| Phase 3 | Tasks 5-6 | mitsein: 配置迁移和初始化重写 |
| Phase 4 | Tasks 7-9 | mitsein: 路由、上下文、API 路由对接 |
| Phase 5 | Task 10 | mitsein: 删除 AWP 代码 |
| Phase 6 | Task 11 | 全量验证 |
