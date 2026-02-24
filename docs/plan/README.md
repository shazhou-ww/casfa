# 功能规划与设计文档

> 最后更新: 2026-02-24

本目录包含各功能模块的规划、设计和实现文档。

## 文档索引

### 核心功能规划

| 文档 | 描述 | 状态 |
|------|------|------|
| [background-sync/](./background-sync/README.md) | 两层异步同步：Layer 1 CAS Node Sync + Layer 2 Depot Commit Sync | ✅ 已实现 |
| [depot-commit-merge.md](./depot-commit-merge.md) | Depot Commit 3-Way Merge：乐观锁 + 客户端自动 merge | 📋 待实现 |
| [mcp-oauth-plan/](./mcp-oauth-plan/README.md) | MCP OAuth 2.1 集成：VS Code 等 MCP 客户端的 OAuth 授权流程 | ✅ 已实现 |
| [mcp-tools/](./mcp-tools/README.md) | MCP Tools & Resources 设计：15+ 工具的详细接口定义 | ✅ 已实现 |
| [file-explorer-component/](./file-explorer-component/) | `<CasfaExplorer />` React 组件的需求规格 | ✅ 已实现 |
| [proof-inline-migration/](./proof-inline-migration/README.md) | Proof 消除：nodeId 直接授权 + Path-as-Proof | ✅ 已实现 |

### 架构演进

| 文档 | 描述 | 状态 |
|------|------|------|
| [token-simplification/](./token-simplification/README.md) | 消除 TokenRecord 表，Token hash 直接存储在 Delegate 实体 | ✅ 已实现 |
| [delegate-token-refactor/](./delegate-token-refactor/README.md) | Delegate 体系原始设计（v1.0），已被 v3.5 权限规格取代 | 📚 历史参考 |
| [ownership-permissions-implementation.md](./ownership-permissions-implementation.md) | 权限体系 v3.5 的自底向上实现计划 | 🔨 部分完成 |

### 代码质量

| 文档 | 描述 | 状态 |
|------|------|------|
| [shared-component-extraction.md](./shared-component-extraction.md) | 单仓库重复代码分析与共享组件抽取 | 🔨 进行中 |
| [storage-has-removal.md](./storage-has-removal.md) | 从 StorageProvider 接口移除 `has()` 的 RFC | 📋 RFC |
| [id-format-unification.md](./id-format-unification.md) | ID 格式统一为 `prefix_[CrockfordBase32]{26}` | ✅ 已完成 |
