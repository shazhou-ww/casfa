# CASFA 文档

> 最后更新: 2026-02-24

## 目录结构

```
docs/
├── README.md                     ← 本文件
├── TODO.md                       ← 项目待办事项
├── casfa-api/                    ← API 接口文档
├── auth-and-permission/          ← 认证与权限体系
├── tech-details/                 ← 技术设计细节
├── plan/                         ← 功能规划与设计文档
└── archive/                      ← 归档文档
```

## 文档导航

### [casfa-api/](./casfa-api/README.md) — API 接口文档

CASFA 全部 HTTP API 的详细文档，包括：

- 服务信息（health、info）
- OAuth / Local Auth 用户认证
- OAuth 2.1 Delegate 授权（MCP 客户端等）
- Admin 管理
- Realm CAS 操作（节点读写、FS 操作、Depot、Delegate 管理）
- CAS 内容服务（`/cas/:key`）
- MCP JSON-RPC 端点

### [auth-and-permission/](./auth-and-permission/README.md) — 认证与权限体系

CASFA 认证（Authentication）与权限（Authorization）的完整设计：

- 三种 Bearer Token（JWT / AT / RT）
- Delegate 树模型（一等业务实体）
- 权限维度与单调非升级规则
- Direct Authorization Check（O(1) 授权判定）
- Ownership 全链写入模型
- Claim 与 Proof-of-Possession

### [tech-details/](./tech-details/README.md) — 技术设计细节

核心技术实现的详细文档：

- CAS 节点二进制格式（v2.2）
- DAG Diff 算法与 3-Way Merge
- Size Flag Byte（O(1) 存储分层路由）
- 环境配置体系
- Monorepo 依赖图
- Redis 缓存架构

### [plan/](./plan/README.md) — 功能规划与设计文档

各功能模块的规划、设计和实现方案：

- Background Sync（两层异步同步）
- Depot Commit 3-Way Merge
- MCP OAuth 2.1 集成
- MCP Tools & Resources
- File Explorer 组件
- Proof 消除（Path-as-Proof 迁移）
- Token 简化
- Delegate Token 重构（v1.0 历史文档）
- 共享组件抽取
- Storage `has()` 移除 RFC
- ID 格式统一（已完成）
- 权限体系实现计划

### [archive/](./archive/) — 归档

历史版本的 API 文档快照。
