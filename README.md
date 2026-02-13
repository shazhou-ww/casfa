# CASFA

CASFA (Content-Addressable Storage for Agents) — 一个基于内容寻址存储的 monorepo，提供从底层存储、二进制编码、授权委托到上层客户端和应用的完整方案。

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Applications                             │
│   ┌──────────────────────┐    ┌──────────────────────────────┐  │
│   │     @casfa/cli       │    │       @casfa/server          │  │
│   │  (命令行工具)         │    │  (Hono 后端 + React 前端)     │  │
│   └────────┬─────────────┘    └──────────┬───────────────────┘  │
├────────────┼─────────────────────────────┼──────────────────────┤
│            │          Client Layer       │                      │
│            │  ┌──────────────────────────┤                      │
│            │  │      @casfa/client       │ 统一授权策略的客户端   │
│            │  ├──────────────────────────┤                      │
│            │  │  @casfa/client-bridge    │ 浏览器主线程客户端     │
│            │  │  @casfa/client-sw        │ Service Worker 端     │
│            │  │  @casfa/port-rpc         │ MessagePort RPC      │
│            │  └──────────────────────────┘                      │
├────────────┼────────────────────────────────────────────────────┤
│            │        Data & FS Layer                             │
│   ┌────────┴───┐  ┌────────────┐  ┌───────────────────┐        │
│   │ @casfa/core│  │ @casfa/fs  │  │ @casfa/explorer   │        │
│   │ (B-Tree    │  │ (文件系统   │  │ (React 文件浏览器  │        │
│   │  编解码)   │  │  操作)      │  │  组件)            │        │
│   └────────────┘  └────────────┘  └───────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│                     Auth & Delegation                           │
│   ┌──────────────┐ ┌─────────────────┐ ┌─────────────────────┐ │
│   │@casfa/delegate│ │@casfa/delegate  │ │@casfa/client-auth   │ │
│   │ (委托类型 &  │ │  -token (二进制 │ │  -crypto (PKCE/     │ │
│   │  校验函数)   │ │  编解码)        │ │  加密/展示码)       │ │
│   └──────────────┘ └─────────────────┘ └─────────────────────┘ │
│   ┌──────────────┐ ┌─────────────────┐                         │
│   │ @casfa/proof │ │ @casfa/cas-uri  │                         │
│   │ (X-CAS-Proof │ │ (CAS URI 解析   │                         │
│   │  头解析/验证)│ │  与格式化)      │                         │
│   └──────────────┘ └─────────────────┘                         │
├─────────────────────────────────────────────────────────────────┤
│                     Storage Layer                               │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │              @casfa/storage-core (接口定义)               │  │
│   └──────────────────────┬───────────────────────────────────┘  │
│          ┌───────────────┼───────────────┐                      │
│   ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐              │
│   │ storage-fs  │ │storage-memory│ │ storage-s3  │              │
│   │ (文件系统)  │ │ (内存/测试)  │ │ (AWS S3)    │              │
│   └─────────────┘ └─────────────┘ └─────────────┘              │
│   ┌─────────────┐ ┌──────────────┐ ┌─────────────┐             │
│   │storage-http │ │storage-      │ │storage-     │             │
│   │ (HTTP 远程) │ │ indexeddb    │ │ cached      │             │
│   │             │ │ (浏览器缓存) │ │ (缓存包装)  │             │
│   └─────────────┘ └──────────────┘ └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│                     Foundation                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │            @casfa/protocol (Zod schemas & types)         │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Packages

### Foundation — 协议与基础类型

| Package | Description |
|---------|-------------|
| `@casfa/protocol` | 协议定义层。使用 Zod 定义 API contract 的所有 schema 和 TypeScript 类型，是大多数包的共同依赖 |
| `@casfa/cas-uri` | CAS URI 的解析与格式化（`cas://` 协议），零依赖 |
| `@casfa/proof` | `X-CAS-Proof` HTTP 头的解析、验证与格式化，零依赖 |

### Storage Layer — 存储抽象与实现

| Package | Description |
|---------|-------------|
| `@casfa/storage-core` | 存储接口定义（`StorageProvider`），所有存储后端的共同抽象，零依赖 |
| `@casfa/storage-fs` | 基于本地文件系统的存储实现，适用于 CLI 和本地开发 |
| `@casfa/storage-memory` | 内存存储实现，主要用于测试 |
| `@casfa/storage-s3` | AWS S3 存储实现，用于生产环境 |
| `@casfa/storage-http` | HTTP 远程存储实现，将 CASFA 节点 API 封装为 `StorageProvider` |
| `@casfa/storage-indexeddb` | 基于 IndexedDB 的浏览器端存储，用于离线缓存 |
| `@casfa/storage-cached` | 缓存装饰器，在远程后端之上叠加本地缓存层 |

### Data & FS Layer — 数据结构与文件操作

| Package | Description |
|---------|-------------|
| `@casfa/core` | CAS 二进制格式的编解码，实现自相似 B-Tree 节点结构。依赖 `storage-core` |
| `@casfa/fs` | 基于 `StorageProvider` 的文件系统操作（创建/读取/遍历目录树等）。依赖 `core` + `protocol` |
| `@casfa/explorer` | React 文件浏览器 UI 组件（MUI），使用 Zustand 管理状态。作为 peer 依赖消费 `client`、`core`、`fs`、`protocol` |

### Auth & Delegation — 授权与委托

| Package | Description |
|---------|-------------|
| `@casfa/delegate` | 委托实体的类型定义和纯验证函数，零依赖 |
| `@casfa/delegate-token` | 委托令牌的二进制编解码，依赖 `protocol` |
| `@casfa/client-auth-crypto` | 客户端认证密码学工具（PKCE 码生成、加密/解密、展示码），依赖 `protocol` |

### Client Layer — 客户端

| Package | Description |
|---------|-------------|
| `@casfa/client` | 核心客户端库，统一管理多种授权策略（delegate token、PKCE 等）。依赖 `cas-uri`、`client-auth-crypto`、`delegate-token`、`protocol` |
| `@casfa/port-rpc` | 基于 MessagePort 的类型安全 RPC 框架，支持超时、Transferable 自动提取和命名空间代理，零依赖 |
| `@casfa/client-bridge` | 浏览器主线程的统一 AppClient，整合 CasfaClient + sync + auth，支持 Service Worker 和直连两种模式 |
| `@casfa/client-sw` | Service Worker 端的消息处理器，做 RPC 分发和 IDB token 存储 |

### Applications

| App | Description |
|-----|-------------|
| `@casfa/server` | CASFA 服务器，后端使用 Hono 框架（可部署至 AWS Lambda），前端使用 React + Vite |
| `@casfa/cli` | 命令行工具，支持内容上传/下载/目录管理等操作 |

## Package Dependencies

核心依赖关系（实线 = 硬依赖，虚线 = peer 依赖）：

```
protocol ─────────────────────────────────────────────────┐
    │                                                     │
    ├── delegate-token ──┐                                │
    ├── client-auth-crypto──┤                             │
    │                    ├── client ◄── cli                │
    │   cas-uri ─────────┘     │                          │
    │                          │(peer)                    │
    │   delegate               ├── client-bridge ◄── server
    │   proof                  │      │                   │
    │                          │   port-rpc               │
    │                          │      │                   │
    │                          └── client-sw              │
    │                                                     │
storage-core ─────────────────────────────────────────────┤
    ├── storage-fs                                        │
    ├── storage-memory                                    │
    ├── storage-s3                                        │
    ├── storage-cached ── storage-indexeddb                │
    ├── storage-http (+ client, protocol, proof)          │
    └── core ── fs ── explorer (peer: client,core,fs)     │
                                                          │
server ◄── (几乎所有包)                                    │
```

## Getting Started

### 环境要求

- **Bun** ≥ 1.x（包管理器 + 运行时 + 测试框架）
- **Node.js** ≥ 20（部分工具链需要）
- **TypeScript** ≥ 5.x

### 安装与构建

```bash
# 克隆仓库
git clone <repo-url> && cd casfa

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
# 全部测试（单元 + e2e）
bun run test

# 仅单元测试
bun run test:unit

# 仅 e2e 测试
bun run test:e2e

# 单个包的测试
cd packages/core && bun test
cd apps/server && bun test
```

### 启动开发服务器

```bash
cd apps/server && bun run dev
```

### 常见开发场景

#### 修改某个 package

1. 修改代码（如 `packages/core/src/`）
2. 运行该包的测试：`cd packages/core && bun test`
3. 重新构建：`bun run build`（或仅构建该包 `cd packages/core && bun run build`）
4. 如有下游依赖，确认下游包也通过测试

#### 新增一个 storage 后端

1. 在 `packages/` 下创建新目录，参考 `storage-memory` 的结构
2. 实现 `@casfa/storage-core` 中定义的 `StorageProvider` 接口
3. 在根 `package.json` 的 `build:packages` 脚本中添加构建步骤
4. 编写测试并添加到 `test:unit` 脚本

#### 修改协议定义

`@casfa/protocol` 是大多数包的共同依赖，修改后需要重新构建并跑全量测试：

```bash
cd packages/protocol && bun run build
bun run test
```

### 提交前检查

目前没有设置提交 gate，请在提交代码前手动运行以下检查：

```bash
# 类型检查 + lint（必须通过）
bun run check

# 运行测试（必须通过）
bun run test
```

如果 lint 有报错，可以尝试自动修复：

```bash
bun run lint:fix

# 或者一步到位（包含 unsafe 修复）
bun run check --fix --unsafe
```

### 项目约定

- **代码风格**：使用 [Biome](https://biomejs.dev/) 进行 lint 和格式化（2 空格缩进，双引号，尾逗号）
- **模块系统**：ESM only，`verbatimModuleSyntax` 开启
- **版本管理**：使用 [Changesets](https://github.com/changesets/changesets) 管理版本和发布
- **构建**：共享构建脚本 `scripts/build-pkg.ts`，各包通过 `bun run build` 调用

## Documentation

- [CAS Binary Format Specification](./docs/CAS_BINARY_FORMAT.md) — CAS 二进制格式规范
- [CASFA API Documentation](./docs/casfa-api/) — API 文档
- [Module Dependency Graph](./docs/module-dependency-graph.md) — 模块依赖关系图
- [Delegate Token Design](./docs/delegate-token-refactor/) — 委托令牌设计文档

## Structure

```
casfa/
├── docs/                    # 文档
├── packages/
│   ├── protocol/            # @casfa/protocol — 协议 schema & 类型
│   ├── cas-uri/             # @casfa/cas-uri — CAS URI 解析
│   ├── proof/               # @casfa/proof — X-CAS-Proof 头处理
│   ├── storage-core/        # @casfa/storage-core — 存储接口
│   ├── storage-fs/          # @casfa/storage-fs — 文件系统存储
│   ├── storage-memory/      # @casfa/storage-memory — 内存存储
│   ├── storage-s3/          # @casfa/storage-s3 — S3 存储
│   ├── storage-http/        # @casfa/storage-http — HTTP 远程存储
│   ├── storage-indexeddb/   # @casfa/storage-indexeddb — IndexedDB 存储
│   ├── storage-cached/      # @casfa/storage-cached — 缓存装饰器
│   ├── core/                # @casfa/core — B-Tree 编解码
│   ├── fs/                  # @casfa/fs — 文件系统操作
│   ├── explorer/            # @casfa/explorer — 文件浏览器组件
│   ├── delegate/            # @casfa/delegate — 委托类型 & 校验
│   ├── delegate-token/      # @casfa/delegate-token — 委托令牌编解码
│   ├── client-auth-crypto/  # @casfa/client-auth-crypto — 认证密码学
│   ├── client/              # @casfa/client — 核心客户端库
│   ├── port-rpc/            # @casfa/port-rpc — MessagePort RPC
│   ├── client-bridge/       # @casfa/client-bridge — 浏览器主线程客户端
│   └── client-sw/           # @casfa/client-sw — Service Worker 处理器
├── apps/
│   ├── server/              # @casfa/server — 服务器 (Hono + React)
│   └── cli/                 # @casfa/cli — 命令行工具
├── scripts/                 # 共享构建脚本
├── biome.json               # Biome 配置
├── tsconfig.json            # 共享 TypeScript 配置
└── package.json             # Workspace 配置
```
