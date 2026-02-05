# @casfa/core

CAS（内容寻址存储）二进制格式编解码库。

## 安装

```bash
bun add @casfa/core
```

## 概述

本包实现了 CAS 节点的核心二进制格式。所有节点使用统一的 32 字节头部，后接可变长度的数据段。

## 节点类型

### Chunk（文件数据）

Chunk 使用自相似的 B-Tree 结构，每个节点包含：
- **data**：原始文件字节（最大 `nodeLimit - header - children*32`）
- **children**：子 chunk 的引用（用于大文件）

这种设计确保了确定性的树拓扑结构：给定文件大小和节点限制，树结构是唯一确定的。

### Dict（目录）

Dict 包含：
- **children**：子节点引用（chunk 或 dict）
- **names**：每个子条目的名称
- **contentType**：可选的 MIME 类型（通常为 `inode/directory`）

## 二进制格式

```
+-------------------------------------------------------------+
|                         HEADER (32 bytes)                    |
+----------+----------+----------+----------+-----------------+
| magic(4) | flags(4) | count(4) | size(8)  | offsets(12)     |
+----------+----------+----------+----------+-----------------+
|                         CHILDREN (N x 32 bytes)              |
+-------------------------------------------------------------+
|                         NAMES (Pascal strings)               |  <- dict only
+-------------------------------------------------------------+
|                         CONTENT-TYPE (Pascal string)         |
+-------------------------------------------------------------+
|                         DATA (raw bytes)                     |  <- chunk only
+-------------------------------------------------------------+
```

### 头部字段

| 偏移 | 大小 | 字段 | 说明 |
|------|------|------|------|
| 0 | 4 | magic | `0x01534143` ("CAS\x01" LE) |
| 4 | 4 | flags | 位标志（hasNames, hasType, hasData） |
| 8 | 4 | count | 子节点数量 |
| 12 | 8 | size | 逻辑大小（chunk 的文件大小） |
| 20 | 4 | namesOffset | NAMES 段偏移量（无则为 0） |
| 24 | 4 | typeOffset | CONTENT-TYPE 段偏移量（无则为 0） |
| 28 | 4 | dataOffset | DATA 段偏移量（无则为 0） |

### 标志位

| 位 | 名称 | 说明 |
|----|------|------|
| 0 | hasNames | 含 NAMES 段（dict） |
| 1 | hasType | 含 CONTENT-TYPE 段 |
| 2 | hasData | 含 DATA 段（chunk） |

## B-Tree 容量公式

对于节点限制 `L`（可用空间 = L - 32 字节头部）：

$$C(d) = \frac{L^d}{32^{d-1}}$$

其中 `d` 为树深度：
- C(1) ≈ 1 MB（叶节点）
- C(2) ≈ 32 GB（2 层树）
- C(3) ≈ 1 PB（3 层树）

## 使用方法

```typescript
import {
  encodeFileNode,
  encodeDictNode,
  decodeNode,
  computeDepth,
  computeLayout,
} from "@casfa/core";

// 编码一个小文件
const data = new Uint8Array([1, 2, 3, 4]);
const file = await encodeFileNode({ data, contentType: "application/octet-stream" }, hashProvider);

// 解码任意节点
const node = decodeNode(file.bytes);
console.log(node.kind); // "file"
console.log(node.size); // 4

// 计算大文件的树结构
const depth = computeDepth(1024 * 1024 * 100, 1024 * 1024); // 100MB 文件，1MB 限制
const layout = computeLayout(1024 * 1024 * 100, 1024 * 1024);
```

## 许可证

MIT
