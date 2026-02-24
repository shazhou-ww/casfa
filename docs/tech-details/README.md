# CASFA 技术细节

> 最后更新: 2026-02-24

本目录包含 CASFA 的核心技术设计文档。

## 文档索引

| 文档 | 描述 | 状态 |
|------|------|------|
| [cas-binary-format.md](./cas-binary-format.md) | CAS 节点二进制格式规格（v2.2）：节点类型、头部/体部布局、B-Tree 分裂、size flag、校验规则 | ✅ 最新 |
| [dag-diff-and-merge.md](./dag-diff-and-merge.md) | `@casfa/dag-diff` 包设计：DAG diff 算法（hash short-circuit sorted merge-join）+ 3-way merge（LWW 冲突解决） | ✅ 最新 |
| [size-flagged-hash.md](./size-flagged-hash.md) | Size Flag Byte：将 8-bit 大小标志嵌入 CAS key 首字节，实现 O(1) 存储分层路由 | ✅ 最新（已集成进 cas-binary-format v2.2） |
| [environment-config.md](./environment-config.md) | 4 环境配置（test/dev/staging/prod）：存储/DB/Redis/Auth/Stack/域名 | ✅ 最新 |
| [module-dependency-graph.md](./module-dependency-graph.md) | Monorepo 4 层架构依赖图：Foundation → Core → Client → Storage Providers | ✅ 最新 |
| [redis-caching.md](./redis-caching.md) | Redis 3 级缓存：Immutable（无 TTL） / Semi-stable（短 TTL） / Optimistic（极短 TTL） | ✅ 最新 |

## 核心技术概要

### CAS 节点

CASFA 使用 **BLAKE3s-128** 哈希（128-bit，Crockford Base32 编码）作为内容地址。节点分三类：

- **d-node（字典）**：有序键值对，建模目录
- **s-node（后继）**：有序值列表，建模大文件 B-Tree 分裂
- **f-node（文件）**：原始字节，建模文件内容

### DAG 与 Depot

节点通过 hash 引用形成 DAG（有向无环图）。**Depot** 是带版本历史的根引用（类似 Git 分支），支持 commit 更新根节点。

### `@casfa/dag-diff`

提供文件系统级别的 DAG diff 与 3-way merge 能力，用于并发编辑冲突检测与自动解决。
