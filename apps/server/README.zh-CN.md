# @casfa/server

CASFA 服务端 - 面向 Agent 的内容寻址存储。

> **注意**：此包为私有包，不发布到 npm。作为独立服务进行部署。

## 功能特性

- 🔐 **委托令牌模型**：三层令牌体系（JWT → 委托令牌 → 访问令牌）
- 📦 **内容寻址存储**：基于 BLAKE3 的 CAS 系统
- 🏠 **Realm 隔离**：每个用户独立的存储空间
- 🎫 **Ticket 系统**：细粒度的临时访问控制
- 📁 **Depot 管理**：类 Git 的版本化数据存储
- 🔄 **多存储后端**：支持 S3、文件系统、内存
- 🤖 **MCP 支持**：Model Context Protocol 集成

## 快速开始

### 前置条件

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/)（用于 DynamoDB Local）

### 启动开发服务器

```bash
# 从仓库根目录
cd apps/server

# 方式一：使用 CLI 工具（推荐）
bun run dev                   # 默认：持久化数据库 + 文件系统存储 + Mock 认证

# 方式二：使用预设模式
bun run dev:minimal          # 全内存模式，无需 Docker（快速测试）
bun run dev:docker           # 持久化 DynamoDB + 文件存储（本地开发）
bun run dev:aws              # 连接 AWS 服务（集成测试）

# 方式三：直接运行服务器
bun run dev:simple           # 直接运行 server.ts
```

### 验证服务

```bash
curl http://localhost:8801/api/health
# {"status":"healthy"}

curl http://localhost:8801/api/info
# {"service":"casfa","version":"0.2.0",...}
```

## 开发模式

| 模式 | 命令 | DynamoDB | 存储 | 认证 | 适用场景 |
|------|------|----------|------|------|----------|
| **minimal** | `dev:minimal` | 内存 (8701) | 内存 | Mock JWT | 端到端测试、快速验证 |
| **docker** | `dev:docker` | 持久化 (8700) | 文件系统 | Mock JWT | 日常开发 |
| **aws** | `dev:aws` | AWS | S3 | Cognito | 集成测试 |

### DynamoDB 端口

| 端口 | 容器 | 模式 | 用途 |
|------|------|------|------|
| **8700** | `dynamodb` | 持久化 | 开发用，数据持久保存 |
| **8701** | `dynamodb-test` | 内存 | 端到端测试，每次运行后清空 |

## 命令一览

```bash
# 开发
bun run dev              # 启动开发服务器（CLI 工具）
bun run dev:simple       # 直接启动服务器
bun run dev:setup        # 一键搭建开发环境

# 测试
bun run test:unit        # 运行单元测试
bun run test:e2e         # 运行端到端测试（自动管理容器）
bun run test:e2e:debug   # 端到端测试（保留容器便于调试）

# 数据库
bun run db:create        # 创建表（端口 8700）
bun run db:create:test   # 创建表（端口 8701）
bun run db:delete        # 删除表

# 构建与部署
bun run build            # 构建 Lambda 部署包
bun run sam:build        # SAM 构建
bun run sam:deploy       # 部署到 AWS

# 代码质量
bun run check            # TypeScript + Biome 检查
bun run lint:fix         # 自动修复 lint 问题
```

## 项目结构

```
apps/server/
├── .env.example          # 环境变量模板
├── package.json
├── tsconfig.json
└── backend/
    ├── server.ts         # 本地开发服务器入口
    ├── e2e/              # 端到端测试
    │   ├── setup.ts
    │   ├── admin.test.ts
    │   ├── auth.test.ts
    │   ├── client-auth.test.ts
    │   ├── depots.test.ts
    │   ├── health.test.ts
    │   ├── nodes.test.ts
    │   ├── realm.test.ts
    │   ├── tickets.test.ts
    │   └── tokens.test.ts
    ├── scripts/
    │   ├── build.ts
    │   ├── create-local-tables.ts
    │   ├── dev-setup.ts
    │   ├── dev.ts
    │   ├── integration-test.ts
    │   └── set-admin.ts
    ├── tests/            # 单元测试
    └── src/
        ├── app.ts        # Hono 应用工厂
        ├── bootstrap.ts  # 依赖初始化
        ├── config.ts     # 配置加载
        ├── handler.ts    # Lambda 入口
        ├── router.ts     # API 路由定义
        ├── types.ts      # 类型定义
        ├── auth/         # 认证模块
        ├── controllers/  # 请求处理器
        ├── db/           # DynamoDB 数据访问
        ├── mcp/          # MCP 协议处理
        ├── middleware/    # Hono 中间件
        ├── schemas/      # Zod 校验模式
        ├── services/     # 业务逻辑
        └── util/         # 工具函数
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT_CASFA_V2_API` | 8801 | API 服务端口 |
| `DYNAMODB_ENDPOINT` | http://localhost:8700 | DynamoDB 端点 |
| `STORAGE_TYPE` | memory | 存储类型：memory / fs / s3 |
| `STORAGE_FS_PATH` | ./data | 文件存储路径（STORAGE_TYPE=fs 时生效） |
| `MOCK_JWT_SECRET` | - | Mock JWT 密钥（本地开发） |
| `COGNITO_USER_POOL_ID` | - | Cognito 配置（生产环境） |

完整配置请参见 `.env.example`。

## API 概览

### 服务

- `GET /api/health` - 健康检查
- `GET /api/info` - 服务信息（存储类型、认证方式、限制）

### OAuth

- `GET /api/oauth/config` - OAuth 配置
- `POST /api/oauth/login` - 用户登录
- `POST /api/oauth/refresh` - 刷新令牌
- `POST /api/oauth/token` - 令牌交换
- `GET /api/oauth/me` - 当前用户信息（需要 JWT）

### 委托令牌

- `POST /api/tokens` - 创建委托令牌（需要 JWT）
- `GET /api/tokens` - 列出令牌（需要 JWT）
- `GET /api/tokens/:tokenId` - 获取令牌详情（需要 JWT）
- `POST /api/tokens/:tokenId/revoke` - 撤销令牌（需要 JWT）
- `POST /api/tokens/delegate` - 再委托令牌（需要委托令牌）

### 令牌请求（客户端授权流程）

- `POST /api/tokens/requests` - 创建授权请求
- `GET /api/tokens/requests/:requestId/poll` - 轮询请求状态
- `GET /api/tokens/requests` - 列出待处理请求（需要 JWT）
- `POST /api/tokens/requests/:requestId/approve` - 批准请求（需要 JWT）
- `POST /api/tokens/requests/:requestId/reject` - 拒绝请求（需要 JWT）

### Realm（需要访问令牌）

- `GET /api/realm/:realmId` - 获取 realm 信息
- `GET /api/realm/:realmId/usage` - 获取使用统计

### Ticket

- `POST /api/realm/:realmId/tickets` - 创建 ticket
- `GET /api/realm/:realmId/tickets` - 列出 ticket
- `GET /api/realm/:realmId/tickets/:ticketId` - 获取 ticket 详情
- `POST /api/realm/:realmId/tickets/:ticketId/submit` - 提交 ticket 结果
- `POST /api/realm/:realmId/tickets/:ticketId/revoke` - 撤销 ticket
- `DELETE /api/realm/:realmId/tickets/:ticketId` - 删除 ticket

### 节点（CAS）

- `POST /api/realm/:realmId/nodes/prepare` - 准备节点上传
- `PUT /api/realm/:realmId/nodes/:key` - 上传节点
- `GET /api/realm/:realmId/nodes/:key` - 获取节点内容
- `GET /api/realm/:realmId/nodes/:key/metadata` - 获取节点元数据

### Depot

- `GET /api/realm/:realmId/depots` - 列出 depot
- `POST /api/realm/:realmId/depots` - 创建 depot
- `GET /api/realm/:realmId/depots/:depotId` - 获取 depot 详情
- `PATCH /api/realm/:realmId/depots/:depotId` - 更新 depot
- `DELETE /api/realm/:realmId/depots/:depotId` - 删除 depot
- `POST /api/realm/:realmId/depots/:depotId/commit` - 提交新版本

### 管理

- `GET /api/admin/users` - 列出用户（需要管理员权限）
- `PATCH /api/admin/users/:userId` - 更新用户角色（需要管理员权限）

### MCP

- `POST /api/mcp` - MCP 协议端点（需要 JWT）

## 测试

端到端测试会自动管理 DynamoDB 容器生命周期：

```bash
bun run test:e2e
```

执行流程：
1. 启动 `dynamodb-test` 容器（端口 8701，内存模式）
2. 等待 DynamoDB 就绪
3. 创建测试表
4. 运行所有端到端测试
5. 清理表和存储
6. 停止并移除容器

调试模式（保留容器）：
```bash
bun run test:e2e:debug
```

## 部署

### AWS SAM

```bash
bun run sam:build
bun run sam:deploy
```

### 手动部署

```bash
bun run build
# 输出: backend/dist/handler.mjs
```

## 相关文档

- CAS 二进制格式
- CASFA API 文档
- 委托令牌重构

## 许可证

MIT
