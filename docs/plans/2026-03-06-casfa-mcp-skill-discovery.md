# Casfa MCP Skill Discovery — 让 agent 自动编排 casfa + image-workshop

## 目标

mitsein 注册 casfa server-next 作为 system MCP endpoint，agent 能自动发现 casfa 的 branch/fs 能力，结合 image-workshop 的 flux_image tool 完成图片生成流程，无需用户手动提供 casfaBaseUrl 或 branchAccessToken。

## 当前状态

- **image-workshop**: 已有 MCP SDK（streamablehttp），已有 skill resource（`skill://flux-image-gen`），已能被 mitsein 注册
- **casfa server-next**: 有 MCP handler（JSON-RPC POST），有 tools（`branch_create`, `fs_*`），但**没有 skill resources**，**没有被 mitsein 配置为 system endpoint**
- **mitsein**: `MCPConnectionManager` 使用 `streamablehttp_client`

## Transport 兼容性（已验证）

~~P1: Transport 不兼容~~ — **不是问题**。

MCP Streamable HTTP 本质就是 JSON-RPC over HTTP + 可选 SSE 流式。`streamablehttp_client` 直接走 POST JSON-RPC，casfa server-next 现有 handler 天然兼容。实测 `streamablehttp_client` POST 到 casfa 的 `/mcp` 走的就是普通 JSON-RPC，只因 casfa 没运行才 502，不是协议问题。

**结论：不需要迁移 MCP SDK，现有 handler 直接能用。**

## 任务拆分

### Task 1: casfa server-next — 添加 resources 支持

**文件：**
- 修改: `apps/server-next/backend/mcp/handler.ts` — switch 中添加 2 个 case
- 新增: `apps/server-next/backend/mcp/skills/casfa-file-management.md`

**改动：**

在 handler.ts 的 switch 语句中添加：

```typescript
case "resources/list":
  response = handleResourcesList(request.id);
  break;
case "resources/read": {
  const params = request.params as { uri?: string } | undefined;
  const uri = params?.uri;
  if (typeof uri !== "string") {
    response = mcpError(request.id, MCP_INVALID_PARAMS, "uri required");
  } else {
    response = handleResourcesRead(request.id, uri);
  }
  break;
}
```

`handleResourcesList` 返回 skill:// resource 列表，`handleResourcesRead` 读取对应的 markdown 文件内容。

### Task 2: 创建 casfa skill 定义

**文件：**
- 新增: `apps/server-next/backend/mcp/skills/casfa-file-management.md`

**内容要点：**

```yaml
---
name: "Casfa File Management"
description: "Branch-based file management with CAS storage"
version: "1.0.0"
category: "storage"
author: "casfa"
allowed-tools: ["branch_create", "branch_complete", "branches_list",
                "fs_ls", "fs_stat", "fs_read", "fs_write",
                "fs_mkdir", "fs_rm", "fs_mv", "fs_cp"]
---
```

Skill 内容引导 agent 理解：
- branch 工作流：`branch_create` → 文件操作 → `branch_complete`
- `branch_create` 返回 `accessToken` 和 `baseUrl`
- 跨 MCP server 编排：`accessToken` + `baseUrl` 可传给 image-workshop 的 `flux_image` 的 `branchAccessToken` + `casfaBaseUrl` 参数

### Task 3: mitsein 配置 casfa 为 system endpoint

**文件：**
- 修改: `backend/.env` — `SYSTEM_MCP_ENDPOINTS` 添加 casfa server-next URL

```
SYSTEM_MCP_ENDPOINTS='[{"url":"http://localhost:7100/mcp","name":"casfa"}]'
```

### Task 4: 端到端验证

1. 启动 casfa server-next + image-workshop
2. 启动 mitsein（自动注册 casfa 为 system endpoint）
3. 验证 `GET /api/user/skills` 返回 casfa 的 skill
4. 发消息 "generate a dog pic" — agent 应自动：
   - `casfa__branch_create(mountPath="images")` → 拿到 `accessToken` + `baseUrl`
   - `image_workshop__flux_image(casfaBaseUrl=baseUrl, branchAccessToken=accessToken, prompt="a dog", filename="dog.png")`

## 依赖关系

```
Task 1 + Task 2（casfa repo，并行）→ Task 3（mitsein repo）→ Task 4（验证）
```

## 开放问题

1. **casfa dev 环境 port**：casfa server-next dev 默认端口是多少？需确认 `CELL_BASE_URL` 设置正确
2. **branch_create 的 baseUrl**：`branch_create` 返回 `baseUrl` 依赖 `config.baseUrl`（`CELL_BASE_URL`）。dev 环境下需确认设置为 `http://localhost:<port>`
