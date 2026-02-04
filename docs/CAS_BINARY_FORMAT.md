# Content Addressed Storage (CAS) Binary Format Specification

> 版本: 2.1  
> 基于: `packages/cas-core` 实现  
> 日期: 2026-02-03

---

## 目录

1. [术语表](#1-术语表)
2. [整体介绍](#2-整体介绍)
3. [Merkle Tree 逻辑结构](#3-merkle-tree-逻辑结构)
4. [节点二进制协议](#4-节点二进制协议)
5. [大文件拆分逻辑](#5-大文件拆分逻辑)
6. [实现约束参数](#6-实现约束参数)
7. [验证规则](#7-验证规则)
8. [Well-Known Keys](#8-well-known-keys)

---

## 1. 术语表

| 术语 | 定义 |
|------|------|
| **CAS** | Content Addressed Storage，内容寻址存储。数据的地址由其内容的哈希值决定 |
| **CAS Key** | 数据的唯一标识符，格式为 `blake3s:<32位十六进制>`，例如 `blake3s:04821167d026fa3b24e160b8f9f0ff2a` |
| **Node** | CAS 中的基本存储单元，一个二进制块，包含 Header 和 Body |
| **d-node** | Dict Node（目录节点），存储有序的子节点名称和引用 |
| **s-node** | Successor Node（续块节点），文件 B-Tree 的内部节点 |
| **f-node** | File Node（文件节点），文件 B-Tree 的根节点，包含 Content-Type |
| **Merkle Tree** | 一种哈希树结构，每个非叶节点的哈希值由其子节点哈希值计算得出 |
| **B-Tree** | 大文件拆分使用的平衡树结构，每个节点既存数据也存子节点引用 |
| **Pascal String** | 以 u16 LE 长度前缀编码的 UTF-8 字符串 |
| **Content-Type** | MIME 类型字符串，描述文件内容类型（如 `application/json`），固定 56 字节槽 |
| **FileInfo** | f-node 的 Payload 头部，包含 fileSize (8 bytes) + contentType (56 bytes) = 64 bytes |
| **Payload Size** | Header.size 字段的含义：Payload 部分的字节数（不含 Header 和 Children） |
| **Node Limit** | 单个节点的最大字节数限制（默认 1 MB） |
| **Hash Provider** | 提供 BLAKE3s-128 哈希计算的抽象接口 |
| **Storage Provider** | 提供节点存取的抽象接口（S3、HTTP、内存等） |

---

## 2. 整体介绍

### 2.1 什么是 Content Addressed Storage

Content Addressed Storage（内容寻址存储）是一种数据存储范式，其核心思想是：

> **数据的地址由其内容决定，而非由存储位置决定。**

在传统存储系统中，数据通过路径（如 `/home/user/file.txt`）或 ID（如数据库主键）定位。这种方式存在问题：

- 同一数据存储多次会占用多倍空间
- 数据被篡改后，标识符不变，无法检测
- 引用其他数据需要依赖外部系统维护一致性

CAS 使用**加密哈希函数**（本规范使用 BLAKE3s-128）计算数据的唯一标识符：

```
Key = "blake3s:" + hex(BLAKE3s-128(data))
```

这带来了关键特性：

| 特性 | 说明 |
|------|------|
| **不可变性** | 一旦存储，数据永不改变。修改数据会产生新的 Key |
| **去重** | 相同内容自动共享同一存储位置 |
| **完整性验证** | 读取数据时可重新计算哈希验证正确性 |
| **分布式友好** | 无中心化命名空间，任何节点可独立生成 Key |

### 2.2 解决什么问题

CAS 特别适用于以下场景：

1. **版本控制系统**：Git 就是基于 CAS 的典型实现
2. **内容分发网络**：相同内容只需存储和传输一次
3. **不可变数据存储**：审计日志、区块链数据
4. **大文件存储**：通过 Merkle Tree 实现增量同步和并行传输

### 2.3 数据模型的自洽性

本规范的核心设计原则是**数据自解释**（Self-Describing Data）：

> **一个 CAS 节点包含理解其内容所需的全部信息，无需外部元数据。**

这意味着：

1. **Content-Type 内嵌**：文件节点（f-node）内嵌 MIME 类型，读取者无需查询外部数据库
2. **结构信息内嵌**：目录节点（d-node）包含子节点名称，无需外部索引
3. **大小信息内嵌**：每个节点包含其逻辑大小，无需遍历计算
4. **哈希即验证**：Key 本身就是数据完整性的证明

这种自洽性使得：

- 任何节点可以独立验证，无需访问其他数据
- 数据可以在任意存储系统间迁移，只需复制字节
- 客户端可以离线验证数据完整性

---

## 3. Merkle Tree 逻辑结构

### 3.1 节点类型概述

CAS 定义三种节点类型，通过 flags 字段的低 2 位区分：

| 类型 | 二进制值 | 十进制 | 用途 |
|------|----------|--------|------|
| **d-node** (Dict) | `0b01` | 1 | 目录，包含有序的命名子节点 |
| **s-node** (Successor) | `0b10` | 2 | 文件续块，B-Tree 内部节点 |
| **f-node** (File) | `0b11` | 3 | 文件顶层节点，包含 Content-Type |

**位含义**：

- Bit 0: 有字符串段（d-node 的名称列表，f-node 的 Content-Type）
- Bit 1: 有数据段（s-node 和 f-node 存储原始数据）

### 3.2 目录结构（d-node）

d-node 表示一个目录，包含零个或多个命名子节点：

```
        ┌─────────────────────────────────┐
        │         d-node (Dict)           │
        │   size = 1500 (总逻辑大小)       │
        └─────────────┬───────────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
      ▼               ▼               ▼
 "config.json"   "readme.md"    "src/" 
      │               │               │
      ▼               ▼               ▼
  f-node          f-node         d-node
  size=256        size=512       size=732
```

**关键规则**：

1. 子节点按**UTF-8 字节序**升序排列（lexicographic byte order）
2. 不允许重复名称
3. `size` 字段 = 所有子节点 `size` 之和（递归）

### 3.3 文件结构（f-node + s-node）

小文件（≤ Node Limit - Header Size）存储在单个 f-node 中：

```
┌─────────────────────────────────┐
│         f-node (File)           │
│   contentType = "text/plain"    │
│   size = 256                    │
│   data = [256 bytes]            │
└─────────────────────────────────┘
```

大文件使用 B-Tree 结构，f-node 作为根节点，s-node 作为内部节点：

```
                    ┌─────────────────────────────────┐
                    │         f-node (Root)           │
                    │   contentType = "video/mp4"     │
                    │   size = 100,000,000            │
                    │   data = [部分数据]              │
                    │   children = [hash1, hash2]     │
                    └─────────────┬───────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              ▼                                       ▼
     ┌─────────────────┐                    ┌─────────────────┐
     │    s-node       │                    │    s-node       │
     │   size = ...    │                    │   size = ...    │
     │   data = [...]  │                    │   data = [...]  │
     │   children=[..] │                    │   children=[]   │
     └────────┬────────┘                    └─────────────────┘
              │
      ┌───────┴───────┐
      ▼               ▼
   s-node          s-node
   (叶子)           (叶子)
```

**数据读取顺序**：

1. 先读取当前节点的 `data` 段
2. 按顺序递归读取每个 `children` 引用的节点
3. 拼接所有数据得到原始文件

### 3.4 Merkle Tree 的安全性

由于每个节点的 Key 是其内容的 BLAKE3s-128 哈希，形成了 Merkle Tree：

```
Root Key = BLAKE3s-128(Header + Children + Data)
                             ↑
                        包含子节点的 Key（哈希值）
```

这意味着：

- **根节点的 Key 隐含验证了整棵树**
- 任何子节点被篡改，父节点的哈希会变化
- 验证根节点等于验证所有数据

---

## 4. 节点二进制协议

### 4.1 通用 Header 格式（16 字节）

所有节点类型共享相同的 16 字节 Header：

```
Offset  Size   Field      Type     Description
────────────────────────────────────────────────────────────────
0-3     4      magic      u32 LE   固定值 0x01534143 ("CAS\x01")
4-7     4      flags      u32 LE   见下文 Flags 字段布局
8-11    4      size       u32 LE   Payload 大小（不含 Header 和 Children）
12-15   4      count      u32 LE   子节点数量
```

**节点总大小计算**：

```
nodeLength = HEADER_SIZE + count × HASH_SIZE + size
           = 16 + count × 16 + size
```

#### 4.1.1 Magic Number

```
字节序列: 0x43, 0x41, 0x53, 0x01 ("CAS\x01" ASCII)
u32 LE 值: 0x01534143
```

用于快速识别 CAS 节点格式。

#### 4.1.2 Flags 字段布局

```
Bits 0-1:   节点类型 (TYPE_MASK = 0b11)
            01 = d-node, 10 = s-node, 11 = f-node
            
Bits 2-3:   Header Extension Count
            表示 Header 后有多少个 16 字节扩展段（默认 0）
            
Bits 4-7:   Block Size Limit
            系统级块大小上限指数，表示 2^n × KB（例如 12 表示 4 MB）
            这是整个系统统一的配置，不是单个节点的实际大小
            
Bits 8-15:  Hash Algorithm
            0 = BLAKE3s-128（当前唯一支持的算法）
            
Bits 16-31: 保留位（必须为 0）
```

#### 4.1.3 Size 字段

`size` 表示 **Payload 大小**（不含 Header 和 Children）：

| 节点类型 | Payload 内容 | size 值 |
|----------|--------------|----------|
| f-node | FileInfo (64) + Data | `64 + data.length` |
| d-node | Names (Pascal strings) | `Σ(2 + name.length)` |
| s-node | Data | `data.length` |

### 4.2 d-node 完整格式

```
┌────────────────────────────────────────┐
│ Header (16 bytes)                      │
├────────────────────────────────────────┤
│ Children (count × 16 bytes)            │  ← BLAKE3s-128 哈希数组
├────────────────────────────────────────┤
│ Names (Pascal strings)                 │  ← 按 UTF-8 字节序排序
└────────────────────────────────────────┘
```

**Children 段**：

- `count` 个连续的 16 字节 BLAKE3s-128 哈希
- 顺序与 Names 段一一对应

**Names 段**：

- `count` 个连续的 Pascal String
- 每个 Pascal String: `[u16 LE 长度][UTF-8 字节]`
- 必须按 UTF-8 字节序严格升序排列

**示例**（2 个子节点）：

```
Offset   Content
0-15     Header (magic=0x01534143, flags=0x01, count=2, ...)
16-31    Child[0] hash (16 bytes)
32-47    Child[1] hash (16 bytes)
48-49    Name[0] length (u16 LE) = 5
50-54    Name[0] bytes "alpha"
55-56    Name[1] length (u16 LE) = 4
57-60    Name[1] bytes "beta"
```

### 4.3 s-node 完整格式

```
┌────────────────────────────────────────┐
│ Header (16 bytes)                      │
│   size = data.length                   │
├────────────────────────────────────────┤
│ Children (count × 16 bytes)            │  ← BLAKE3s-128 哈希数组
├────────────────────────────────────────┤
│ Data (raw bytes)                       │  ← 原始文件数据片段
└────────────────────────────────────────┘
```

**示例**（1 个子节点，100 字节数据）：

```
Offset   Content
0-15     Header (flags=0x02, count=1, size=100)
16-31    Child[0] hash (16 bytes)
32-131   Data (100 bytes)
```

**注意**：s-node 不需要 Padding，因为 Header(16) + Children(N×16) 已经是 16 的倍数。

### 4.4 f-node 完整格式

```
┌────────────────────────────────────────┐
│ Header (16 bytes)                      │
│   size = 64 + data.length              │
├────────────────────────────────────────┤
│ Children (count × 16 bytes)            │  ← BLAKE3s-128 哈希数组
├────────────────────────────────────────┤
│ FileInfo (64 bytes)                    │  ← 文件元信息
│   0-7:   fileSize (u64 LE)             │  ← 原始文件总大小
│   8-63:  contentType (56 bytes)        │  ← null-padded ASCII
├────────────────────────────────────────┤
│ Data (raw bytes)                       │  ← 原始文件数据片段
└────────────────────────────────────────┘
```

**FileInfo 段（64 字节）**：

- `fileSize` (8 bytes): 原始文件的总字节数（整个 B-Tree 表示的文件大小）
- `contentType` (56 bytes): MIME 类型，ASCII 编码，不足部分用 0x00 填充
  - 仅允许 printable ASCII (0x20-0x7E)
  - 最大有效长度 56 字节（足够大多数 MIME 类型）

**对齐规则**：

- Header = 16 字节（16 的倍数）
- Children = N × 16 字节（16 的倍数）
- FileInfo = 64 字节（16 的倍数）
- 因此 Data 段自然对齐到 16 字节边界

**示例**（无子节点，contentType="application/json"，50 字节数据）：

```
Offset   Content
0-15     Header (flags=0x03, count=0, size=114)
         flags = 0b11 = f-node
         size = 64 + 50 = 114
16-23    fileSize: 50 (u64 LE)
24-79    contentType: "application/json" + zeros (56 bytes)
80-129   Data (50 bytes)
```

### 4.5 Pascal String 编码

Pascal String 用于 d-node 的子节点名称：

```
┌────────────┬───────────────────────────────┐
│ Length     │ UTF-8 Bytes                   │
│ (u16 LE)   │ (0-65535 bytes)               │
└────────────┴───────────────────────────────┘
```

- 最大长度：65,535 字节（u16 上限）
- 编码：UTF-8
- 验证：解码时使用 `fatal` 模式检测无效 UTF-8

---

## 5. 大文件拆分逻辑

### 5.1 为什么需要拆分

当文件大小超过 `nodeLimit - HEADER_SIZE` 时（默认约 1 MB - 16 = 1,048,560 字节），需要将文件拆分为多个节点。

**不拆分的问题**：

1. 单个节点过大影响传输效率
2. 无法并行上传/下载
3. 小改动需要重新上传整个文件

### 5.2 B-Tree 拓扑设计

CAS 使用**贪婪填充 B-Tree**（Greedy Fill B-Tree）而非传统的 CDC（Content-Defined Chunking）：

**核心思想**：

- 每个节点既存储数据，也存储子节点引用
- 子节点引用各占 16 字节（BLAKE3s-128 哈希）
- 优先填满最左侧节点

**容量公式**：

深度 $d$ 的 B-Tree 最大容量：

$$C(d) = \frac{L^d}{16^{d-1}}$$

其中：

- $d$ = 树深度（1 = 叶节点，2 = 一层内部节点 + 叶节点，...）
- $L$ = 每节点可用空间 = `nodeLimit - HEADER_SIZE`

**推导**：

- 深度 1（叶节点）：$C(1) = L$（全部空间存数据）
- 深度 2：根节点存 $L - 16n$ 字节数据，$n$ 个子节点各存 $L$ 字节
  - 最优时 $n = L/16$，容量 = $L + n \times L \approx L^2/16$
- 以此类推

### 5.3 深度计算算法

```typescript
function computeDepth(fileSize: number, nodeLimit: number): number {
  if (fileSize <= 0) return 1;
  
  let depth = 1;
  while (computeCapacity(depth, nodeLimit) < fileSize) {
    depth++;
    if (depth > 10) {
      throw new Error("File too large");
    }
  }
  return depth;
}

function computeCapacity(depth: number, nodeLimit: number): number {
  const L = nodeLimit - HEADER_SIZE;  // 可用空间
  if (depth === 1) return L;
  
  // 使用对数避免溢出
  const logCapacity = depth * Math.log(L) - (depth - 1) * Math.log(16);
  return Math.min(Math.exp(logCapacity), Number.MAX_SAFE_INTEGER);
}
```

### 5.4 贪婪填充布局算法

布局算法决定每个节点存储多少数据、有多少子节点：

```typescript
function computeLayout(fileSize: number, nodeLimit: number): LayoutNode {
  const depth = computeDepth(fileSize, nodeLimit);
  return computeLayoutAtDepth(fileSize, depth, nodeLimit);
}

function computeLayoutAtDepth(
  remainingSize: number,
  depth: number,
  nodeLimit: number
): LayoutNode {
  const L = nodeLimit - HEADER_SIZE;
  
  // 叶节点：全部空间存数据
  if (depth === 1) {
    return {
      depth: 1,
      dataSize: Math.min(remainingSize, L),
      children: []
    };
  }
  
  // 如果剩余数据能放入当前节点，无需子节点
  if (remainingSize <= L) {
    return { depth, dataSize: remainingSize, children: [] };
  }
  
  // 计算需要多少子节点
  const childCapacity = computeCapacity(depth - 1, nodeLimit);
  
  // 每个子节点贡献 childCapacity 容量，消耗 16 字节指针空间
  // 设 n 个子节点，则：
  //   myData = L - n * 16
  //   n * childCapacity + myData >= remainingSize
  //   n * (childCapacity - 16) >= remainingSize - L
  //   n >= (remainingSize - L) / (childCapacity - 16)
  
  const childCount = Math.ceil(
    (remainingSize - L) / (childCapacity - 16)
  );
  const myDataSize = L - childCount * 16;
  
  // 递归构建子节点布局
  let leftover = remainingSize - myDataSize;
  const children: LayoutNode[] = [];
  
  for (let i = 0; i < childCount; i++) {
    const childSize = Math.min(leftover, childCapacity);
    children.push(
      computeLayoutAtDepth(childSize, depth - 1, nodeLimit)
    );
    leftover -= childSize;
  }
  
  return { depth, dataSize: myDataSize, children };
}
```

### 5.5 多层 B-Tree 示例

以默认 `nodeLimit = 1 MB` 为例：

| 深度 | 最大容量 | 典型用途 |
|------|----------|----------|
| 1 | ~1 MB | 小文件，单节点 |
| 2 | ~64 GB | 中等文件，根节点 + 叶子 |
| 3 | ~4 PB | 大文件，三层结构 |
| 4 | ~256 EB | 理论上限 |

**深度 2 示例**（存储 50 MB 文件）：

```
                    ┌─────────────────────────────────────┐
                    │           f-node (Root)             │
                    │   dataSize ≈ 1MB - 50×32 = ~998 KB  │
                    │   children = [50 hashes]            │
                    └───────────────────┬─────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
   ┌─────────┐                     ┌─────────┐                    ┌─────────┐
   │ s-node  │                     │ s-node  │       ...          │ s-node  │
   │ ~1 MB   │                     │ ~1 MB   │                    │ 剩余    │
   └─────────┘                     └─────────┘                    └─────────┘
```

**深度 3 示例**（存储 10 GB 文件）：

```
                              f-node (Root)
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
                ▼                 ▼                 ▼
            s-node            s-node            s-node
           (层 2)             (层 2)             (层 2)
                │
        ┌───────┼───────┐
        │       │       │
        ▼       ▼       ▼
     s-node  s-node  s-node
    (叶子)   (叶子)   (叶子)
```

### 5.6 上传流程

上传使用**自底向上**策略：

```typescript
async function uploadFileNode(
  ctx: CasContext,
  data: Uint8Array,
  offset: number,
  contentType: string,
  layout: LayoutNode,
  totalFileSize: number,
  isRoot: boolean
): Promise<Uint8Array> {  // 返回节点哈希
  
  const nodeData = data.slice(offset, offset + layout.dataSize);
  
  // 叶节点：直接编码上传
  if (layout.children.length === 0) {
    const encoded = isRoot
      ? await encodeFileNode({ data: nodeData, contentType, fileSize: totalFileSize }, hash)
      : await encodeSuccessorNode({ data: nodeData }, hash);
    await storage.put(hashToKey(encoded.hash), encoded.bytes);
    return encoded.hash;
  }
  
  // 内部节点：先上传所有子节点
  const childHashes: Uint8Array[] = [];
  let childOffset = offset + layout.dataSize;
  
  for (const childLayout of layout.children) {
    const childHash = await uploadFileNode(
      ctx, data, childOffset, contentType, childLayout, totalFileSize, false
    );
    childHashes.push(childHash);
    childOffset += computeTotalSize(childLayout);
  }
  
  // 编码当前节点（包含子节点哈希）并上传
  const encoded = isRoot
    ? await encodeFileNode(
        { data: nodeData, contentType, fileSize: totalFileSize, children: childHashes },
        hash
      )
    : await encodeSuccessorNode(
        { data: nodeData, children: childHashes },
        hash
      );
  
  await storage.put(hashToKey(encoded.hash), encoded.bytes);
  return encoded.hash;
}
```

### 5.7 读取流程

读取使用**深度优先前序遍历**：

```typescript
async function readFileData(ctx: CasContext, node: CasNode): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  
  // 1. 先读取当前节点的数据
  if (node.data) {
    parts.push(node.data);
  }
  
  // 2. 按顺序读取子节点
  if (node.children) {
    for (const childHash of node.children) {
      const childNode = await getNode(ctx, hashToKey(childHash));
      const childData = await readFileData(ctx, childNode);
      parts.push(childData);
    }
  }
  
  return concatBytes(...parts);
}
```

---

## 6. 实现约束参数

### 6.1 核心常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAGIC` | `0x01534143` | "CAS\x01" little-endian |
| `HEADER_SIZE` | 16 字节 | 所有节点类型共用 |
| `HASH_SIZE` | 16 字节 | BLAKE3s-128 输出长度 |
| `DATA_ALIGNMENT` | 16 字节 | 数据段对齐边界 |
| `DEFAULT_NODE_LIMIT` | 1,048,576 字节 (1 MB) | 默认单节点最大值 |

### 6.2 大小限制

| 限制项 | 值 | 说明 |
|--------|-----|------|
| **最大 Payload Size** | $2^{32} - 1 \approx 4$ GB | u32 上限 |
| **最大 File Size** | $2^{64} - 1$ | FileInfo.fileSize 为 u64 |
| **最大树深度** | 10 | 硬编码安全限制 |
| **最大 Content-Type 长度** | 56 字节 | FileInfo 中固定槽大小 |
| **最大 Pascal String 长度** | 65,535 字节 | u16 上限 |

### 6.3 单节点子节点数约束

d-node 的子节点数受限于 Pascal String 总长度：

```
节点总大小 = Header + Children + Names
          = 16 + N × 16 + Σ(2 + len(name_i))
          ≤ nodeLimit
```

**最坏情况**（所有名称为空字符串）：

- 每个子节点消耗：16（哈希）+ 2（Pascal 长度前缀）= 18 字节
- 最大子节点数：$(nodeLimit - 16) / 18 \approx 58,252$（1 MB 节点）

**最佳情况**（无名称段，仅 s-node/f-node 的子节点）：

- 每个子节点消耗：16 字节（哈希）
- 最大子节点数：$(nodeLimit - 16) / 16 = 65,535$（1 MB 节点）

### 6.4 不同 Node Size 下的容量对比

| Node Limit | 深度 1 | 深度 2 | 深度 3 |
|------------|--------|--------|--------|
| 64 KB | ~64 KB | ~256 MB | ~1 TB |
| 256 KB | ~256 KB | ~4 GB | ~64 TB |
| 1 MB | ~1 MB | ~64 GB | ~4 PB |
| 4 MB | ~4 MB | ~1 TB | ~256 PB |

### 6.5 Size 字段说明

**Header.size (u32)**：

- 表示 Payload 大小，最大约 4 GB
- 单节点通常限制在 1 MB，所以 u32 绑绑有余

**FileInfo.fileSize (u64)**：

- 表示原始文件总大小
- 使用 JavaScript `number` 存储时上限为 `Number.MAX_SAFE_INTEGER` ≈ 9 PB
- 二进制格式支持完整 64 位（约 16 EB）

```typescript
// FileInfo.fileSize 编码（u64 LE）
const sizeLow = fileSize >>> 0;
const sizeHigh = Math.floor(fileSize / 0x100000000) >>> 0;
view.setUint32(offset, sizeLow, true);
view.setUint32(offset + 4, sizeHigh, true);

// 解码
const sizeLow = view.getUint32(offset, true);
const sizeHigh = view.getUint32(offset + 4, true);
const fileSize = sizeLow + sizeHigh * 0x100000000;
```

---

## 7. 验证规则

服务端接收节点时执行分层验证。

### 7.1 Header 强校验（必须）

| 规则 | 说明 |
|------|------|
| **Magic 验证** | 前 4 字节必须为 `0x43, 0x41, 0x53, 0x01` |
| **Flags 验证** | bits 16-31（保留位）必须全为 0 |
| **长度一致性** | `buffer.length == 16 + count × 16 + size` |
| **哈希验证** | `blake3s(buffer) == expectedKey` |

### 7.2 Payload 校验

#### 7.2.1 f-node 校验

| 规则 | 说明 |
|------|------|
| **size 一致性** | `size >= 64`（至少包含 FileInfo） |
| **contentType 字符集** | 仅允许 printable ASCII (0x20-0x7E) 或 0x00 |
| **contentType padding** | 有效字符后必须全为 0x00 |

#### 7.2.2 d-node 校验

| 规则 | 说明 |
|------|------|
| **Names 完整性** | 能解析出恰好 `count` 个 Pascal string |
| **UTF-8 有效性** | 使用 `fatal` 模式解码，拒绝无效 UTF-8 |
| **排序验证** | 名称必须按 UTF-8 字节序严格升序 |
| **唯一性验证** | 不允许重复名称 |

#### 7.2.3 s-node 校验

| 规则 | 说明 |
|------|------|
| **填充校验** | 如果节点有 children，则本节点数据段必须填满（达到 block size limit） |

#### 7.2.4 f-node/s-node 填充规则

对于 f-node 和 s-node，存在一个重要的结构性约束：

> **只有填满的节点才能有子节点。**

即：如果 `count > 0`（有子节点），则本节点的数据段必须达到 block size limit。

这确保了 B-Tree 的正确性——数据优先填充当前节点，只有当前节点满了才会"溢出"到子节点。

### 7.3 不做的校验

| 项目 | 理由 |
|------|------|
| **fileSize 一致性** | 需要遍历整棵 B-Tree 计算实际数据总和，代价高 |
| **子节点存在性** | 按需验证，非上传时强制 |

### 7.4 验证实现示例

```typescript
const HEADER_SIZE = 16;
const HASH_SIZE = 16;
const FILEINFO_SIZE = 64;
const RESERVED_MASK = 0xffff0000;  // bits 16-31

async function validateNode(
  buffer: Uint8Array,
  expectedKey: string,
  hashProvider: HashProvider
): Promise<ValidationResult> {
  // === Layer 1: Header 强校验 ===
  
  // 1. 验证 Magic
  if (!buffer.slice(0, 4).every((b, i) => b === MAGIC_BYTES[i])) {
    return { valid: false, error: "Invalid magic number" };
  }
  
  // 2. 解码 Header
  const header = decodeHeader(buffer);
  
  // 3. 验证 Flags 保留位 (bits 16-31)
  if ((header.flags & RESERVED_MASK) !== 0) {
    return { valid: false, error: "Reserved flag bits are set" };
  }
  
  // 4. 验证长度一致性
  const expectedLength = HEADER_SIZE + header.count * HASH_SIZE + header.size;
  if (buffer.length !== expectedLength) {
    return { valid: false, error: `Length mismatch: ${buffer.length} != ${expectedLength}` };
  }
  
  // 5. 验证哈希
  const hash = await hashProvider.hash(buffer);
  const actualKey = hashToKey(hash);
  if (actualKey !== expectedKey) {
    return { valid: false, error: `Hash mismatch` };
  }
  
  // === Layer 2: Payload 校验 ===
  const nodeType = header.flags & 0b11;
  
  if (nodeType === NODE_TYPE.FILE) {
    // f-node: 验证 contentType
    if (header.size < FILEINFO_SIZE) {
      return { valid: false, error: "f-node size too small for FileInfo" };
    }
    // contentType 字符集验证...
  } else if (nodeType === NODE_TYPE.DICT) {
    // d-node: 验证 names 完整性、排序、唯一性
    // ...
  }
  // s-node: 无特殊校验
  
  return { valid: true, kind: nodeType };
}
```

---

## 8. Well-Known Keys

Well-Known Keys 是预计算的特殊节点，具有系统级意义。

### 8.1 Empty Dict（空目录）

**用途**：新 Depot 的初始根节点

**字节内容**（16 字节）：

```
Offset   Content
0-3      Magic: 0x43, 0x41, 0x53, 0x01
4-7      Flags: 0x01, 0x00, 0x00, 0x00 (d-node, hash_algo=0)
8-11     Size: 0x00, 0x00, 0x00, 0x00 (size = 0, no names)
12-15    Count: 0x00, 0x00, 0x00, 0x00 (count = 0)
```

**Key**：

```
blake3s:0000b2da2b8398251c05e6a73a6f1918
```

或使用 node: 前缀的 Crockford Base32 格式：

```
node:000B5PHBGEC2A705WTKKMVRS30
```

**生成代码**：

```typescript
const EMPTY_DICT_BYTES = new Uint8Array(16);
const view = new DataView(EMPTY_DICT_BYTES.buffer);
view.setUint32(0, 0x01534143, true);  // magic
view.setUint32(4, 0x01, true);        // flags = d-node (hash_algo=0 in bits 8-15)
view.setUint32(8, 0, true);           // size = 0 (no names payload)
view.setUint32(12, 0, true);          // count = 0

const hash = blake3s_128(EMPTY_DICT_BYTES);
const key = "blake3s:" + bytesToHex(hash);
```

### 8.2 使用场景

1. **初始化 Depot**：创建新存储库时，使用 Empty Dict 作为初始根
2. **空目录表示**：任何空目录都可以直接引用此 Key，无需重复存储
3. **快速判断**：检测到此 Key 即可确定为空目录，无需读取内容

---

## 附录 A: 字节序约定

本规范所有多字节整数使用 **Little-Endian (LE)** 字节序：

```
u16 值 0x1234 存储为: 0x34, 0x12
u32 值 0x12345678 存储为: 0x78, 0x56, 0x34, 0x12
u64 值 0x123456789ABCDEF0 存储为: 0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x34, 0x12
```

## 附录 B: 参考实现

核心实现位于 `packages/cas-core/src/`：

| 文件 | 功能 |
|------|------|
| `constants.ts` | 常量定义 |
| `types.ts` | TypeScript 类型 |
| `header.ts` | Header 编解码 |
| `node.ts` | 节点编解码 |
| `topology.ts` | B-Tree 拓扑算法 |
| `utils.ts` | Pascal String、Hex 工具 |
| `controller.ts` | 高层 API |
| `validation.ts` | 严格验证 |
| `well-known.ts` | 预定义节点 |
