# server-next 使用 Serverless Framework 开发调研

## 目标

在现有 **server-next**（Bun + Hono，当前 `Bun.serve` 单机）基础上，用 **Serverless Framework** 部署到 AWS（Lambda + API Gateway），并利用你提供的 **user-serverless MCP** 做文档查询与资源查看。

---

## 现有技术栈摘要

| 项目       | 说明 |
|------------|------|
| 运行时     | Bun |
| Web 框架   | Hono |
| 入口       | `src/index.ts`：`createApp(deps)` → `Bun.serve({ port, fetch: app.fetch })` |
| 配置       | `loadConfig()` 从环境变量读取（PORT, STORAGE_*, COGNITO_* 等） |
| 部署方式   | 当前未定义（本地 `bun run dev`） |

---

## 两种可行方案

### 方案 A：Node.js Lambda + Hono AWS Lambda 适配器（不用 Docker）

- **思路**：Lambda 用 Node 运行时，Hono 通过官方 `hono/aws-lambda` 的 `handle(app)` 导出 handler，API Gateway HTTP API 触发该 handler。
- **优点**：无需 Docker/ECR，部署快、配置简单，与 Serverless Framework 原生支持一致。
- **缺点**：运行时从 Bun 改为 **Node**，需保证依赖与代码在 Node 下可用（你们当前用 Bun，若有 Bun 专属 API 需替换或做兼容）。

**需要做的事：**

1. **新增 Lambda 专用入口**（例如 `src/lambda.ts`）  
   - 复用现有 `createApp(deps)` 与依赖组装逻辑（config、cas、realm、stores 等）。  
   - 使用 Hono 的 AWS Lambda 适配器导出 handler：

   ```ts
   import { handle } from "hono/aws-lambda";
   import { createApp } from "./app";
   // ... 组装 deps、createApp(deps) ...

   export const handler = handle(app);
   ```

2. **在 server-next 根目录增加 `serverless.yml`**（仅保留与 server-next 相关部分）：

   ```yaml
   service: casfa-server-next

   provider:
     name: aws
     runtime: nodejs20.x
     stage: ${opt:stage, 'dev'}
     region: ${opt:region, 'us-east-1'}
     httpApi:
       payload: '2.0'
       cors: true
     environment:
       STORAGE_TYPE: ${env:STORAGE_TYPE, 'memory'}
       # 其他 STORAGE_FS_PATH, COGNITO_* 等按需用 ${env:...} 或 SSM
   ```

3. **配置一个函数 + HTTP API 全路由**：

   ```yaml
   functions:
     api:
       handler: src/lambda.handler
       events:
         - httpApi: '*'
   ```

4. **打包与依赖**  
   - 若为 ESM：确保 `package.json` 的 `"type": "module"` 与 Serverless 的 Node 版本一致。  
   - 在 `serverless.yml` 中可按需设置 `package`（include/exclude），把 `src/**`、必要 node_modules 打进去；或使用 monorepo 时指定 `serverless.yml` 所在目录为 service 根目录，由 Framework 自动打包。

5. **本地开发**  
   - 继续用现有 `bun run dev` 跑 Hono（Bun）；  
   - 或使用 `serverless dev` / `serverless offline` 等在本地模拟 Lambda + HTTP API，此时会走 Node 和 `lambda.handler`。

**MCP 可配合的：**  
- 部署后可用 **list-projects**（确认 workspace 下的 serverless 项目）→ **list-resources**（看 Lambda、API Gateway 等）→ **aws-lambda-info / aws-http-api-gateway-info** 等查看详情；**docs** 查 Serverless 文档。

---

### 方案 B：Bun + Docker 镜像（Lambda Container Image）

- **思路**：不改成 Node，保持 Bun。用 **Lambda 容器镜像**：容器内跑 Bun，通过 [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) 把 HTTP 请求转给 `Bun.serve`（监听 8080）。Serverless Framework 通过 **ECR + 镜像** 部署该容器为 Lambda。
- **优点**：继续用 Bun 与现有 `index.ts`（`Bun.serve`）逻辑，无需写 Lambda handler，本地与云端同一套运行方式。
- **缺点**：需要构建并推送 Docker 镜像、配置 ECR；冷启动与镜像体积一般比纯 Node 大一些。

**需要做的事：**

1. **Dockerfile**（在 server-next 根目录或你指定的 context）  
   - 参考 [Bun 官方 Lambda 指南](https://bun.sh/docs/guides/deployment/aws-lambda)：  
     - 使用 `public.ecr.aws/awsguru/aws-lambda-adapter` 作为 Lambda 适配器；  
     - 使用 `oven/bun:debian` 等官方 Bun 镜像；  
     - `ENV PORT=8080`，`CMD ["bun", "run", "src/index.ts"]`（或你实际入口）。  
   - 复制 `package.json`、锁文件、源码，在镜像内 `bun install --production`。

2. **serverless.yml**  
   - 使用 **provider.ecr.images** 定义“由 Serverless 构建并推送到 ECR”的镜像，例如：

   ```yaml
   service: casfa-server-next

   provider:
     name: aws
     stage: ${opt:stage, 'dev'}
     region: ${opt:region, 'us-east-1'}
     httpApi:
       payload: '2.0'
       cors: true
     ecr:
       images:
         app:
           path: .
           file: Dockerfile
           platform: linux/amd64
   ```

   - 函数使用 **image** 而非 **handler**：

   ```yaml
   functions:
     api:
       image: app
       events:
         - httpApi: '*'
   ```

3. **环境变量**  
   - 在 `provider.environment` 或 `functions.api.environment` 中注入 `STORAGE_TYPE`、`COGNITO_*` 等，与当前 `loadConfig()` 一致。

4. **本地开发**  
   - 不变：`bun run dev` 直接跑现有 `index.ts`。

**MCP 可配合的：**  
- 同上，部署后用 **list-resources**、**aws-lambda-info**、**aws-http-api-gateway-info** 等查看 Lambda（容器）与 HTTP API。

---

## 本地开发与测试如何支持

### 1. 本地开发（日常写代码、联调）

| 方式 | 方案 A（Node Lambda） | 方案 B（Bun 容器） |
|------|------------------------|---------------------|
| **推荐日常用法** | `bun run dev`：继续用现有 `src/index.ts`（Bun.serve），不改动、不依赖 Serverless。 | 同左：`bun run dev`，与当前完全一致。 |
| **可选：模拟 Lambda 环境** | 使用 **serverless-offline** 或 **serverless dev**：在本地用 Node 跑 `lambda.handler`，通过模拟的 HTTP API 触发，便于验证“上线后 Lambda 路径”是否正常。 | 本地即 Bun，无需额外模拟；若要完全一致可 `docker run` 同款镜像（一般不必）。 |

**结论**：  
- **两种方案下日常开发都无需改**：继续 `bun run dev`，改代码、调 API 都用现有流程。  
- 方案 A 若希望“本地就走 Lambda 入口”，可在 `serverless.yml` 里加 `serverless-offline` 插件，再跑 `serverless offline`（或 `serverless dev`），此时会走 Node + `src/lambda.handler`，E2E 的 baseUrl 可指向该本地端口做一次额外验证（见下）。

**serverless-offline 示例（仅方案 A 需要时）：**

```yaml
# serverless.yml
plugins:
  - serverless-offline

# 运行: npx serverless offline
# 默认会在本地起一个 HTTP 服务（如 3000），请求会转给 Lambda handler
```

---

### 2. 单元测试（现有即可）

- **命令**：`bun run test:unit`（即 `bun test tests/`）。  
- **内容**：测的是 `createApp`、middleware、controllers、services 等逻辑，直接调用 Hono `app.request(...)` 或 mock，**不依赖真实 HTTP 或 Lambda**。  
- **结论**：引入 Serverless 后**不需要改**单元测试；只要业务代码仍通过 `createApp(deps)` 暴露，单测继续有效。

---

### 3. E2E 测试（与 Serverless 的配合）

当前 E2E 结构（`e2e/setup.ts`）：

- 在进程内用 **同一份 `createApp(deps)`** 组装 app，再 `Bun.serve({ fetch: app.fetch })` 起一个临时 HTTP 服务（端口随机）。  
- 所有 E2E 通过 `ctx.baseUrl` 和 `ctx.helpers` 对该服务发请求。  
- 也就是说：E2E 测的是 **“createApp 整棵逻辑”**，不区分“是否在 Lambda 里跑”。

**两种方案下 E2E 的建议：**

| 方案 | 建议 |
|------|------|
| **方案 A** | 继续用现有 E2E（`bun run test:e2e`）：起的是 Bun + createApp，与部署到 Lambda 的“Node + handle(app)”**共用同一套 app 逻辑**，足以覆盖接口行为。若还想验证“真实走 Lambda 入口”，可额外在 CI 或本地先起 `serverless offline`，再把 E2E 的 baseUrl 指向 offline 的地址跑一遍（可选）。 |
| **方案 B** | 现有 E2E 完全适用：本地和 Lambda 都是 Bun + 同一份 `index.ts`，无需改。 |

**注意**：`e2e/setup.ts` 里组装 `createApp` 时传入的 deps 应与 `src/index.ts` 保持一致（例如若 app 需要 `userSettingsStore`，setup 里也要传入），否则部分路由可能未覆盖到。

---

### 4. 推荐脚本与 CI 建议

在 `package.json` 里可保持或补充：

```json
{
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun run test:unit && bun run test:e2e",
    "test:unit": "bun test tests/",
    "test:e2e": "bun test e2e/"
  }
}
```

- **本地**：`bun run dev` 开发，`bun run test` 跑单测+E2E。  
- **CI**：同上，先 `bun run test`，通过后再 `sls deploy`（或你的部署命令）。  
- **可选**：在 CI 中 deploy 到 dev stage 后，用部署得到的 HTTP API URL 再跑一轮 E2E（真实 Lambda + 真实 API Gateway），成本较高，按需使用。

---

### 5. 小结

| 维度 | 方案 A（Node Lambda） | 方案 B（Bun 容器） |
|------|------------------------|---------------------|
| 日常开发 | `bun run dev`（不变） | `bun run dev`（不变） |
| 单元测试 | `bun run test:unit`（不变） | 同左 |
| E2E 测试 | `bun run test:e2e`（不变）；可选再用 serverless-offline 验证 Lambda 路径 | `bun run test:e2e`（不变） |
| 可选“完全像 Lambda” | 装 serverless-offline，跑 `serverless offline` | 本地已是 Bun，无需；要可 docker run 同镜像 |

整体上：**本地开发与测试可以继续沿用现有方式**，Serverless 主要影响的是“部署形态”；只有在你想在本地完全模拟 Lambda 调用时（方案 A），才需要额外使用 serverless-offline 或 `serverless dev`。

---

## 你提供的 MCP（user-serverless）能做什么

- **docs**：查 Serverless Framework（sf）文档，例如 `serverless.yml`、AWS provider、httpApi、functions、ECR 镜像等，便于写配置。  
- **list-projects**：在指定 workspace 下发现 serverless 项目（需用户确认路径）。  
- **list-resources**：按 service 名（如 `casfa-server-next-dev`）+ 类型（serverless-framework）列出已部署资源。  
- **aws-lambda-info / aws-http-api-gateway-info / aws-logs-tail** 等：查看 Lambda、API Gateway、日志等，便于排障与观测。  

**注意**：MCP 偏重“已有 serverless 项目”的发现、文档与资源查看，不直接替你执行 `serverless deploy`；部署仍需在本地或 CI 里执行 `sls deploy`（或配合你已有的脚本）。

---

## 建议

- **若可以接受在 Lambda 上使用 Node 而非 Bun**：优先考虑 **方案 A**，实现快、与 Serverless 文档和 MCP 的“Lambda + HTTP API”示例一致，且你已有 Hono，适配器成熟。  
- **若必须保留 Bun**：用 **方案 B**，用官方 Bun + Lambda Adapter 的 Docker 方式，并由 Serverless 的 ECR + `httpApi` 统一管理 API 与部署。  

无论哪种方案，都建议：  
- 保持 **createApp(deps)** 与业务逻辑不变，只增加“Lambda 入口”或“镜像内启动命令”；  
- 环境变量与当前 **config** 对齐，便于本地与云端一致；  
- 部署后使用 MCP 的 **list-resources** 与 **aws-*** 工具做一次核对，确认 HTTP API URL、Lambda 名称、环境变量等是否符合预期。

如需，我可以按你选的方案（A 或 B）给出针对本仓库的 `serverless.yml` 和入口文件的具体补全版本（含 monorepo 路径与 env 占位符）。

---

## 实现说明（server-next 当前状态）

- 已采用 **方案 A**（Node Lambda + Hono `handle(app)`），本地开发与 E2E 使用 **serverless-offline**。
- 使用 **Serverless Framework v4**（`frameworkVersion: "4"`）；v4 要求先执行 `serverless login`（个人/小团队免费），之后方可使用 `serverless offline` 与 `serverless deploy`。
