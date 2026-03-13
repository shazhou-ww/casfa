# Image Workshop (MCP Server)

基于 **Cell** 的 MCP Server（Streamable HTTP），提供 **FLUX 文生图** 能力：调用 BFL API 生成图片，将结果上传到指定 Casfa branch 并 complete。登录复用 **SSO**，delegate 授权与 **cell-delegates-*** 对齐。

## 环境变量

按 `docs/cell-config-rules.md` 约定：

- 复制 **`.env.example`** 为 `.env`，填写 `LOG_LEVEL`、`SSO_BASE_URL`、`BFL_API_KEY`（必填）。
- 本地开发：复制 **`.env.local.example`** 为 `.env.local`，覆盖 `PORT_BASE`、`SSO_BASE_URL`（如 `http://localhost:7100`）、`LOG_LEVEL` 等。

cell-cli 根据 `PORT_BASE` 推算本地 DynamoDB 等端口（如 DynamoDB = PORT_BASE+2）。

| 变量 | 说明 |
|------|------|
| `LOG_LEVEL` | 日志级别（如 `info`、`debug`）。 |
| `SSO_BASE_URL` | SSO cell 地址（部署如 `https://auth.casfa.shazhou.me`，本地如 `http://localhost:7100`）。 |
| `BFL_API_KEY` | BFL API Key，从 [BFL Dashboard](https://dashboard.bfl.ai/) 获取。 |

## 本地运行

```bash
cd apps/image-workshop
bun install --no-cache
cp .env.example .env
cp .env.local.example .env.local   # 填写本地 SSO_BASE_URL、PORT_BASE 等
bun run dev
```

`cell dev` 会启动 frontend、backend（dev-app）、以及本地 DynamoDB 等。登录时跳转到 SSO，完成登录后回到本应用。

## 部署

```bash
bun run deploy
```

部署后 MCP 客户端可连接该 Cell 的 HTTP API（Streamable HTTP），并通过 delegate OAuth（`/oauth/authorize`、`/oauth/token`）获取 token 后调用 `/mcp`。

## Tool: `flux_image`

- **入参**
  - `casfaBranchUrl`（必填）：Casfa branch 根 URL，用 `branch_create` 返回的 `accessUrlPrefix`，一条 URL 即可访问该 branch，无需再传 token。
  - `prompt`（必填）：FLUX 文生图提示词。
  - 可选：`width`、`height`、`seed`、`safety_tolerance`、`output_format`。

- **出参（成功）**
  - `success`: `true`
  - `completed`: 被合并的 branchId（图片出现在该 branch 的 mountPath 下）。
  - `key`: 生成图片的 CAS 节点 key。

- **出参（失败）**
  - `success`: `false`，`error`: 错误信息。

- **流程**
  1. 使用 BFL FLUX API 生成图片。
  2. 将图片写入 branch 根（PUT /api/realm/me/root），再 complete branch。

## 工程结构

- `backend/app.ts`：`createApp(deps)`，SSO 重定向、delegate OAuth、delegates API、MCP 路由。
- `backend/config.ts`：配置（与 server-next 对齐）。
- `backend/lambda.ts`：Lambda 入口。
- `backend/dev-app.ts`：本地 dev 入口（`cell dev`）。
- `frontend/main.tsx`：登录（重定向到 SSO）、delegate 同意页（cell-delegates-webui）、delegates 管理。
