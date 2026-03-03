# Image Workshop (MCP Server)

基于 **Lambda** 的 MCP Server（Streamable HTTP），提供 **FLUX 文生图** 能力：调用 BFL API 生成图片，将结果上传到指定 Casfa branch 并 complete。也可本地用 stdio 运行。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `BFL_API_KEY` | 是 | BFL API Key，从 [BFL Dashboard](https://dashboard.bfl.ai/) 获取。Lambda 部署时通过 env 注入。 |

Casfa 的 base URL 由 **tool 参数 `casfaBaseUrl`** 提供，不再使用环境变量。

## 部署（Lambda）

```bash
cd apps/image-workshop
bun install --no-cache
export BFL_API_KEY=your_key
bun run deploy
```

或指定 stage：`serverless deploy --stage prod`。部署后得到 HTTP API 的 URL，MCP 客户端连接该 URL（Streamable HTTP）即可。

## 本地运行

**stdio（本地 MCP 进程）：**

```bash
cp .env.example .env   # 填入 BFL_API_KEY
bun run start
```

**模拟 Lambda（serverless-offline）：**

```bash
export BFL_API_KEY=your_key
bun run offline
```

默认 httpPort 7201，MCP 路径为根路径（任意 `*` 由 transport 处理）。

## Tool: `flux_image`

- **入参**
  - `casfaBaseUrl`（必填）：Casfa server 基地址，如 `https://api.example.com` 或 `http://localhost:7100`。
  - `branchAccessToken`（必填）：Casfa branch 的 access token（Bearer）。
  - `filename`（必填）：保存到 branch 的文件名，如 `output.png`、`images/hero.jpeg`。
  - `prompt`（必填）：FLUX 文生图提示词。
  - 可选：`width`、`height`（默认 1024）、`seed`、`safety_tolerance`（0–5，默认 2）、`output_format`（`jpeg` \| `png`，默认 `jpeg`）。

- **流程**
  1. 使用 BFL FLUX API 根据 `prompt` 与可选参数生成图片。
  2. 使用 `casfaBaseUrl` + `branchAccessToken` 将图片以 `filename` 上传到对应 Casfa branch。
  3. 调用该 Casfa 的 complete branch 接口完成 branch（合并回 parent）。

- **返回**  
  成功时返回 JSON：`{ success: true, path, key, completed }`；失败时 `isError: true` 并带 `error` 信息。

## 依赖

- [BFL API](https://docs.bfl.ai/)：FLUX 文生图（如 `flux-2-pro`）。
- Casfa server-next：Branch 文件上传与 complete 接口（Bearer branch token）；base URL 由调用方通过 `casfaBaseUrl` 传入。

## 工程

- `src/index.ts`：`flux_image` tool 逻辑与 `createMcpServer`。
- `src/app.ts`：Hono + Web Standard Streamable HTTP transport（Lambda 入口用）。
- `src/lambda.ts`：Lambda handler，路径规范化。
- `src/stdio.ts`：stdio 入口（本地 `bun run start`）。
- `src/bfl.ts`：BFL 提交任务、轮询、下载图片。
- `src/casfa-branch.ts`：Casfa 上传文件与 complete branch（baseUrl 由调用方传入）。
