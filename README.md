# CASFA

CASFA (Content-Addressable Storage for Agents) — 面向 AI Agent 和多应用协作场景的内容寻址平台。把文件存储、权限授权、Agent 调用、MCP 工具接入统一在一个协议和平台里。

## Quick Start

```bash
# 1. 安装依赖
bun install

# 2. 构建所有包
bun run build

# 3. 确保 Docker Desktop 已启动，AWS SSO 已登录
aws configure sso

# 4. 启动开发服务器
bun run dev

# 5. 首次登录后，设置自己为管理员（user ID 可在页面右上角用户菜单中查看并复制）
cd apps/main && bun run set-admin <user-id>
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Cells (Applications)                      │
│  ┌───────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌──────────────┐ │
│  │  sso  │ │ drive  │ │ agent  │ │ artist  │ │   gateway    │ │
│  │(认证) │ │(文件)  │ │(对话)  │ │(图像)   │ │(MCP 聚合)    │ │
│  └───┬───┘ └───┬────┘ └───┬────┘ └────┬────┘ └──────┬───────┘ │
├──────┼─────────┼──────────┼───────────┼─────────────┼──────────┤
│      │      Shared Cell Packages      │             │          │
│  ┌───┴──────────┴──────────┴───────────┴─────────────┘          │
│  │ cell-auth-server · cell-auth-webui · cell-auth-client       │
│  │ cell-cognito-server · cell-cognito-webui                    │
│  │ cell-delegates-server · cell-delegates-webui                │
│  │ cell-mcp                                                    │
│  └──────────────────────────────────────────────────────────┐  │
├─────────────────────────────────────────────────────────────┤  │
│                     CAS Core Layer                          │  │
│  ┌──────────────┐  ┌─────────┐  ┌──────────┐               │  │
│  │ @casfa/core  │  │@casfa/  │  │@casfa/   │               │  │
│  │ (B-Tree      │  │ cas     │  │ encoding │               │  │
│  │  编解码)     │  │ (CAS    │  │ (Base32/ │               │  │
│  │              │  │  facade)│  │  Base64) │               │  │
│  └──────┬───────┘  └────┬───┘  └──────────┘               │  │
├─────────┼───────────────┼──────────────────────────────────┤  │
│         │      Storage Layer                               │  │
│  ┌──────┴──────────────────────────────────────────────┐   │  │
│  │              @casfa/storage-core (接口定义)          │   │  │
│  └──────────────────────┬──────────────────────────────┘   │  │
│         ┌───────────────┼───────────────┐                  │  │
│  ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐          │  │
│  │ storage-fs  │ │storage-     │ │ storage-s3  │          │  │
│  │ (文件系统)  │ │  memory     │ │ (AWS S3)    │          │  │
│  │             │ │ (测试用)    │ │             │          │  │
│  └─────────────┘ └─────────────┘ └─────────────┘          │  │
├────────────────────────────────────────────────────────────┤  │
│                     Tooling                                │  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │  │
│  │ apps/otavia  │ │apps/cell-cli │ │ apps/main    │       │  │
│  │ (Cell 编排   │ │(Cell 开发    │ │ (部署配置)   │       │  │
│  │  CLI 框架)   │ │  CLI)        │ │              │       │  │
│  └──────────────┘ └──────────────┘ └──────────────┘       │  │
└────────────────────────────────────────────────────────────┘  │
```

## Cells

Cell 是 CASFA 的微服务单元，每个 Cell 有独立的 backend（Hono/Lambda）、frontend（React/Vite）、DynamoDB 表和 OAuth scope。

| Cell | Description |
|------|-------------|
| `sso` | SSO 认证中心。基于 AWS Cognito，提供 OAuth authorize/callback/token/refresh 流程 |
| `drive` | 核心文件存储。CAS 内容寻址 + Realm 命名空间 + Branch 任务分支 + Delegate 委托授权 + MCP 工具 |
| `agent` | Agent 对话。Thread/Message 管理、MCP Server 配置、LLM Provider 设置 |
| `artist` | 图像生成 MCP 服务。通过 BFL API 生成图像，以 MCP tool 形式暴露 |
| `gateway` | MCP 服务器网关。聚合多个 MCP server 的工具发现、OAuth 代理、统一执行入口 |

## Packages

### CAS Core — 内容寻址核心

| Package | Description |
|---------|-------------|
| `@casfa/core` | CAS 二进制格式的编解码，实现自相似 B-Tree 节点结构 |
| `@casfa/cas` | Level 0 CAS：内容寻址存储，含 GC 和 key 索引 |
| `@casfa/encoding` | 编码工具：Crockford Base32、Base64URL、hex |

### Storage — 存储抽象与实现

| Package | Description |
|---------|-------------|
| `@casfa/storage-core` | 存储接口定义（`StorageProvider`），所有存储后端的共同抽象 |
| `@casfa/storage-fs` | 基于本地文件系统的存储实现，用于 CLI 和本地开发 |
| `@casfa/storage-memory` | 内存存储实现，用于测试 |
| `@casfa/storage-s3` | AWS S3 存储实现，用于生产环境 |

### Cell Auth — 认证授权

| Package | Description |
|---------|-------------|
| `@casfa/cell-auth-server` | Cell 后端认证：Cookie/Bearer token 读取、JWT 验证、CSRF |
| `@casfa/cell-auth-webui` | Cell 前端认证：cookie-only apiFetch、SSO logout/refresh |
| `@casfa/cell-auth-client` | CLI/非浏览器认证：Bearer token 模式 |
| `@casfa/cell-cognito-server` | SSO 后端：Cognito JWT 验证、code-for-token 交换、refresh |
| `@casfa/cell-cognito-webui` | SSO 前端：Cognito 登录页、consent 页 |
| `@casfa/cell-delegates-server` | Delegate 管理：list/create/revoke + OAuth 授权码流程 |
| `@casfa/cell-delegates-webui` | Delegate OAuth consent 页面 UI |

### MCP

| Package | Description |
|---------|-------------|
| `@casfa/cell-mcp` | Builder 风格的 MCP server：HTTP transport、可选 auth、Zod 工具验证 |

### Tooling — 开发工具

| App | Description |
|-----|-------------|
| `apps/otavia` | Otavia CLI — Cell 编排框架，管理 dev/build/test/deploy 全流程 |
| `apps/cell-cli` | Cell 开发 CLI — 单个 Cell 的本地开发工具 |
| `apps/main` | 主部署配置 — otavia.yaml 定义 Cell 组合和部署参数 |
| `apps/main-symbiont` | 辅助部署配置（symbiont 实例） |

## Getting Started

### 环境要求

- **Bun** ≥ 1.x（包管理器 + 运行时 + 测试框架）
- **Node.js** ≥ 20（部分工具链需要）
- **TypeScript** ≥ 5.x
- **Docker Desktop**（本地开发依赖 DynamoDB Local + MinIO）

### 安装与构建

```bash
# 克隆仓库
git clone https://github.com/shazhou-ww/casfa.git && cd casfa

# 安装依赖
bun install

# 构建所有包（按依赖顺序）
bun run build

# 类型检查
bun run typecheck

# Lint 检查 / 自动修复
bun run lint
bun run lint:fix

# 运行全部检查
bun run check
```

### 运行测试

```bash
# 全部单元测试
bun run test

# 单个包的测试
cd packages/core && bun run test:unit
cd cells/drive && bun run test:unit
```

### 启动开发服务器

```bash
# 启动（需 Docker Desktop 运行 + AWS SSO 已登录）
bun run dev

# 带 Cloudflare Tunnel（远程访问）
bun run otavia dev --tunnel
```

### 首次运行

登录后，点击右上角用户菜单查看 User ID（`usr_` 格式），然后设置管理员：

```bash
cd apps/main

# 本地 DynamoDB
bun run set-admin <user-id>

# AWS DynamoDB
bun run set-admin:aws <user-id>
```

## Deployment

### CI/CD

Push 到 `main` 自动部署（GitHub Actions）：
- SAM build + deploy（Lambda + API Gateway）
- Vite build → S3（静态前端）
- CloudFront 缓存失效

### 手动部署

```bash
cd apps/main
bun run deploy           # 全量部署
bun run deploy:frontend  # 仅前端
```

### 基础设施

| Component | Service |
|-----------|---------|
| 计算 | AWS Lambda (Node.js 20) |
| API | API Gateway + CloudFront |
| 存储 | S3 (CAS blob) + DynamoDB (metadata) |
| 认证 | AWS Cognito |
| DNS | Route53 |
| 域名 | `beta.casfa.shazhou.me` |

## Project Structure

```
casfa/
├── cells/                   # Cell 微服务
│   ├── sso/                 # SSO 认证中心
│   ├── drive/               # 核心文件存储
│   ├── agent/               # Agent 对话与 MCP 编排
│   ├── artist/              # 图像生成 MCP
│   └── gateway/             # MCP 服务器网关
├── packages/                # 共享包
│   ├── core/                # CAS B-Tree 编解码
│   ├── cas/                 # CAS facade + GC
│   ├── encoding/            # Base32/Base64URL 编码
│   ├── storage-core/        # 存储接口定义
│   ├── storage-fs/          # 文件系统存储
│   ├── storage-memory/      # 内存存储（测试）
│   ├── storage-s3/          # S3 存储
│   ├── cell-auth-server/    # Cell 后端认证
│   ├── cell-auth-webui/     # Cell 前端认证
│   ├── cell-auth-client/    # CLI 认证
│   ├── cell-cognito-server/ # Cognito 后端
│   ├── cell-cognito-webui/  # Cognito 前端
│   ├── cell-delegates-server/ # Delegate 管理
│   ├── cell-delegates-webui/  # Delegate consent UI
│   └── cell-mcp/           # MCP server builder
├── apps/                    # 工具与配置
│   ├── otavia/              # Otavia CLI 框架
│   ├── cell-cli/            # Cell 开发 CLI
│   ├── main/                # 主部署配置
│   └── main-symbiont/       # 辅助部署配置
├── docs/                    # 文档
├── scripts/                 # 共享构建脚本
├── biome.json               # Biome 配置
├── tsconfig.json            # 共享 TypeScript 配置
├── stack.yaml               # Stack 定义
└── package.json             # Workspace 配置
```

## Conventions

- **代码风格**：[Biome](https://biomejs.dev/)（2 空格缩进，双引号，尾逗号）
- **模块系统**：ESM only，`verbatimModuleSyntax` 开启
- **编码风格**：纯函数式，用 `type` 不用 `interface`，用 create 函数不用 `class`
- **版本管理**：[Changesets](https://github.com/changesets/changesets)
- **运行时**：Bun（不用 npm/pnpm/node 直接运行）

## Documentation

- [Cell 配置规则](./docs/cell-config-rules.md)
- [编码规范](./docs/CODING-CONVENTIONS.md)
- [Cloudflare Tunnel 开发](./docs/cloudflare-tunnel-dev.md)
- [设计文档](./docs/plans/)
