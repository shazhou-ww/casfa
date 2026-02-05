# CAS URI 规范

> 版本: 1.0  
> 日期: 2026-02-05

---

## 目录

1. [概述](#1-概述)
2. [URI 格式](#2-uri-格式)
3. [Root 类型](#3-root-类型)
4. [Path 语义](#4-path-语义)
5. [Index Path 语义](#5-index-path-语义)
6. [Relative Path](#6-relative-path)
7. [URI 解析与格式化](#7-uri-解析与格式化)

---

## 1. 概述

### 1.1 为什么需要 CAS URI

在 CAS 系统中，节点通过其内容 hash 直接寻址。但直接使用 hash 存在以下问题：

| 问题 | 说明 |
|------|------|
| **权限验证困难** | 无法判断一个 hash 是否在 Token 的 scope 内 |
| **路径语义缺失** | hash 不携带在树中的位置信息 |
| **可读性差** | 32 位十六进制难以理解和调试 |

CAS URI 通过提供结构化的寻址格式解决这些问题。

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **确定性** | 给定 URI 可唯一定位到 CAS 节点 |
| **可验证** | 可以验证节点是否在授权 scope 内 |
| **分层结构** | 支持 root + path + index 多层定位 |
| **相对寻址** | 支持相对于上下文的简化表示 |
| **自顶向下** | 解析时自顶向下，任何一级不存在则整个路径无效 |

---

## 2. URI 格式

### 2.1 完整格式

```
cas://root/path#index-path
```

**组成部分**:

| 部分 | 必选 | 说明 |
|------|------|------|
| `cas://` | 是 | 协议前缀 |
| `root` | 是 | 根节点标识 |
| `/path` | 否 | 基于名称的路径 |
| `#index-path` | 否 | 基于索引的路径 |

### 2.2 示例

```
# 仅 root
cas://depot:4XZRT7Y2M5K9BQWP

# root + path
cas://depot:4XZRT7Y2M5K9BQWP/src/main.ts

# root + index-path
cas://node:ABCD1234EFGH5678#0:2:1

# root + path + index-path
cas://depot:4XZRT7Y2M5K9BQWP/src#0:1
```

### 2.3 语法定义 (ABNF)

```abnf
cas-uri       = "cas://" root [ "/" path ] [ "#" index-path ]

root          = root-type ":" root-id
root-type     = "node" / "depot" / "ticket"
root-id       = 1*base32-char

path          = segment *( "/" segment )
segment       = *pchar  ; 符合 RFC 3986 的路径段

index-path    = index *( ":" index )
index         = 1*DIGIT

base32-char   = "0" / "1" / "2" / "3" / "4" / "5" / "6" / "7" / "8" / "9"
              / "A" / "B" / "C" / "D" / "E" / "F" / "G" / "H" 
              / "J" / "K" / "M" / "N" / "P" / "Q" / "R" / "S" 
              / "T" / "V" / "W" / "X" / "Y" / "Z"
                     ; Crockford Base32 字符集 (排除 I, L, O, U)
```

---

## 3. Root 类型

Root 标识 CAS 树的根节点，支持三种类型：

### 3.1 node: - 直接节点引用

**格式**: `node:crockford_base32(node_hash)`

**用途**: 直接引用一个已知 hash 的 CAS 节点

**示例**:
```
cas://node:000B5PHBGEC2A705WTKKMVRS30
```

**说明**:
- `node_hash` 是 16 字节的 Blake3-128 hash
- Base32 编码后长度为 26 个字符
- 主要用于引用不可变的历史节点

### 3.2 depot: - Depot 引用

**格式**: `depot:crockford_base32(depot_id)`

**用途**: 引用 Depot 的当前 root 节点

**示例**:
```
cas://depot:4XZRT7Y2M5K9BQWP
```

**说明**:
- `depot_id` 是数据库中的 Depot ID
- 解析时获取 Depot 的当前 `root` 字段作为实际节点 hash
- Depot 的 root 可能会随 commit 更新

### 3.3 ticket: - Ticket 引用

**格式**: `ticket:crockford_base32(ticket_id)`

**用途**: 引用 Ticket 工作空间的 root 节点

**示例**:
```
cas://ticket:7YNMQ3KP2JDFHW8X
```

**说明**:
- `ticket_id` 是数据库中的 Ticket ID
- Ticket 是一个可 submit 的工作空间
- 解析时获取 Ticket 关联的 root 节点

### 3.4 Root 解析流程

```
┌─────────────────────────────────────────────────────────────┐
│                     Root 解析流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  cas://node:XXXXX           cas://depot:XXXXX               │
│         │                          │                         │
│         ▼                          ▼                         │
│  ┌─────────────┐            ┌─────────────┐                 │
│  │ Base32 解码  │            │ 查询 Depot  │                 │
│  │ 得到 hash   │            │ 获取 root   │                 │
│  └──────┬──────┘            └──────┬──────┘                 │
│         │                          │                         │
│         └──────────┬───────────────┘                        │
│                    ▼                                         │
│             ┌─────────────┐                                  │
│             │  Node Hash  │                                  │
│             └─────────────┘                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Path 语义

> **注意**：Path 语义在本次重构中**暂不使用**，但需要在 core 中支持，作为 CAS URI 逻辑的组成部分。
> Path 比 index-path 更加 human-readable，适用于面向用户的高级 API。

### 4.1 定义

Path 是基于 d-node (目录节点) 的 children names 组成的路径，类似于文件系统路径。

### 4.2 格式

```
/segment1/segment2/segment3
```

**规则**:
- 每个 segment 对应 d-node 的一个 child name
- segment 使用 UTF-8 编码
- 特殊字符需要 URL 编码

### 4.3 示例

给定目录结构：

```
root (d-node)
├── src (d-node)
│   ├── main.ts (f-node)
│   └── utils (d-node)
│       └── helper.ts (f-node)
└── README.md (f-node)
```

对应的 CAS URI：

| 目标节点 | CAS URI |
|----------|---------|
| root | `cas://depot:XXX` |
| src | `cas://depot:XXX/src` |
| main.ts | `cas://depot:XXX/src/main.ts` |
| helper.ts | `cas://depot:XXX/src/utils/helper.ts` |
| README.md | `cas://depot:XXX/README.md` |

### 4.4 Path 解析

```typescript
async function resolvePath(
  rootHash: Uint8Array,
  path: string[],
  storage: StorageProvider
): Promise<Uint8Array> {
  let currentHash = rootHash;

  for (const segment of path) {
    const node = await storage.get(hashToKey(currentHash));
    if (!node) throw new Error("Node not found");

    const decoded = decodeNode(node);
    if (decoded.kind !== "dict") {
      throw new Error("Cannot traverse non-dict node");
    }

    const childIndex = decoded.childNames?.indexOf(segment);
    if (childIndex === undefined || childIndex === -1) {
      throw new Error(`Child "${segment}" not found`);
    }

    currentHash = decoded.children![childIndex];
  }

  return currentHash;
}
```

---

## 5. Index Path 语义

### 5.1 定义

Index Path 是基于节点 children 列表中的位置索引组成的路径，用于精确且紧凑地定位子节点。

### 5.2 格式

```
#index1:index2:index3
```

**规则**:
- 以 `#` 开始
- 索引使用 `:` 分隔
- 每个索引是非负整数
- 索引从 0 开始

### 5.3 示例

给定目录结构（children 按 UTF-8 字节序排列）：

```
root (d-node, children: [README.md, src])
├── README.md (index 0)
└── src (index 1, children: [main.ts, utils])
    ├── main.ts (index 0)
    └── utils (index 1, children: [helper.ts])
        └── helper.ts (index 0)
```

对应的 Index Path：

| 目标节点 | Index Path | 等效 Path |
|----------|------------|-----------|
| root | (无) | (无) |
| README.md | `#0` | `/README.md` |
| src | `#1` | `/src` |
| main.ts | `#1:0` | `/src/main.ts` |
| utils | `#1:1` | `/src/utils` |
| helper.ts | `#1:1:0` | `/src/utils/helper.ts` |

### 5.4 Index Path 的优势

| 优势 | 说明 |
|------|------|
| **紧凑** | 数字比名称更短 |
| **确定性** | 不受名称重命名影响 |
| **验证友好** | 易于验证子节点属于父节点 |
| **适合授权** | Token scope 验证使用 index path |
| **可穿透** | 可以从 f-node 继续向下索引到 c-node（内容块）|

### 5.5 Index Path 穿透 f-node

Index-path 不仅可以遍历 d-node 的 children，还可以穿透 f-node 访问其内容块（c-node）：

```
f-node (文件节点)
├── c-node[0] (第一个内容块)
├── c-node[1] (第二个内容块)
└── c-node[2] (第三个内容块)
```

例如 `#1:0:2` 可以表示：根节点的第 1 个 child（f-node），该 f-node 的第 0 个子节点（可能是 d-node 或继续是 f-node 的子块），再向下第 2 个。

### 5.6 Index Path 解析

```typescript
async function resolveIndexPath(
  rootHash: Uint8Array,
  indices: number[],
  storage: StorageProvider
): Promise<Uint8Array> {
  let currentHash = rootHash;

  for (const index of indices) {
    const node = await storage.get(hashToKey(currentHash));
    if (!node) throw new Error("Node not found");

    const decoded = decodeNode(node);
    if (!decoded.children || index >= decoded.children.length) {
      throw new Error(`Child index ${index} out of bounds`);
    }

    currentHash = decoded.children[index];
  }

  return currentHash;
}
```

---

## 6. Relative Path

### 6.1 定义

在有上下文（如 Token scope）的情况下，可以使用相对路径简化 URI 表示。

### 6.2 类型

| 前缀 | 类型 | 说明 |
|------|------|------|
| `./` | Path 相对 | 从当前 path 继续 |
| `.:` | Index 相对 | 从当前 index-path 继续 |

### 6.3 Path 相对路径

**格式**: `./segment1/segment2`

**规则**:
- 以 `./` 开始
- 从上下文的 path 终点继续
- **忽略上下文的 index-path 部分**

**示例**:

| 上下文 | 相对路径 | 解析结果 |
|--------|----------|----------|
| `cas://depot:X/src` | `./utils` | `cas://depot:X/src/utils` |
| `cas://depot:X/src#1` | `./main.ts` | `cas://depot:X/src/main.ts` |

### 6.4 Index 相对路径

**格式**: `.:index1:index2`

**规则**:
- 以 `.:` 开始
- 从上下文的 index-path 终点继续
- 保留上下文的 path 和 index-path

**示例**:

| 上下文 | 相对路径 | 解析结果 |
|--------|----------|----------|
| `cas://depot:X#1` | `.:0` | `cas://depot:X#1:0` |
| `cas://depot:X/src#1:2` | `.:0:1` | `cas://depot:X/src#1:2:0:1` |

### 6.5 转签发中的相对路径

转签发时使用 relative index-path 限定子 scope：

```
父 Token scope: cas://depot:X (root)
转签发参数: [".:1", ".:0"]  
新 Token scope: [cas://depot:X#1, cas://depot:X#0]
```

这样新 Token 只能访问 root 的第 0 和第 1 个子节点。

---

## 7. URI 解析与格式化

### 7.1 解析流程

```
┌─────────────────────────────────────────────────────────────┐
│                     URI 解析流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 验证协议前缀 "cas://"                                    │
│                    │                                         │
│                    ▼                                         │
│  2. 解析 Root (type:id)                                      │
│     ├── node: → 直接使用 hash                                │
│     ├── depot: → 查询数据库获取 root                         │
│     └── ticket: → 查询数据库获取 root                        │
│                    │                                         │
│                    ▼                                         │
│  3. 解析 Path (如果存在)                                     │
│     └── 逐段在 d-node 中查找 child                           │
│                    │                                         │
│                    ▼                                         │
│  4. 解析 Index Path (如果存在)                               │
│     └── 逐级在 children 中定位                               │
│                    │                                         │
│                    ▼                                         │
│  5. 返回最终节点 hash                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 TypeScript 类型定义

```typescript
/**
 * 解析后的 CAS URI
 */
type ParsedCasUri = {
  /** Root 类型 */
  rootType: "node" | "depot" | "ticket";
  /** Root ID (base32 字符串) */
  rootId: string;
  /** Path 段 (可选) */
  path?: string[];
  /** Index Path (可选) */
  indexPath?: number[];
};

/**
 * 解析后的相对路径
 */
type ParsedRelativePath = {
  /** 相对路径类型 */
  type: "path" | "index";
  /** Path 段 (type=path 时) */
  path?: string[];
  /** Index 段 (type=index 时) */
  indices?: number[];
};
```

### 7.3 解析实现

```typescript
const CAS_URI_REGEX = /^cas:\/\/(\w+):([A-Z0-9]+)(\/[^#]*)?(#[\d:]+)?$/i;

function parseCasUri(uri: string): ParsedCasUri {
  const match = uri.match(CAS_URI_REGEX);
  if (!match) {
    throw new Error(`Invalid CAS URI: ${uri}`);
  }

  const [, rootType, rootId, pathPart, indexPart] = match;

  if (!["node", "depot", "ticket"].includes(rootType.toLowerCase())) {
    throw new Error(`Unknown root type: ${rootType}`);
  }

  const result: ParsedCasUri = {
    rootType: rootType.toLowerCase() as "node" | "depot" | "ticket",
    rootId: rootId.toUpperCase(),
  };

  if (pathPart) {
    result.path = pathPart
      .slice(1) // 去掉开头的 /
      .split("/")
      .filter(s => s.length > 0)
      .map(s => decodeURIComponent(s));
  }

  if (indexPart) {
    result.indexPath = indexPart
      .slice(1) // 去掉开头的 #
      .split(":")
      .map(s => parseInt(s, 10));
  }

  return result;
}
```

### 7.4 格式化实现

```typescript
function formatCasUri(parsed: ParsedCasUri): string {
  let uri = `cas://${parsed.rootType}:${parsed.rootId}`;

  if (parsed.path && parsed.path.length > 0) {
    uri += "/" + parsed.path.map(s => encodeURIComponent(s)).join("/");
  }

  if (parsed.indexPath && parsed.indexPath.length > 0) {
    uri += "#" + parsed.indexPath.join(":");
  }

  return uri;
}
```

### 7.5 相对路径解析

```typescript
function parseRelativePath(relative: string): ParsedRelativePath {
  if (relative.startsWith("./")) {
    return {
      type: "path",
      path: relative.slice(2).split("/").filter(s => s.length > 0),
    };
  }

  if (relative.startsWith(".:")) {
    return {
      type: "index",
      indices: relative.slice(2).split(":").map(s => parseInt(s, 10)),
    };
  }

  throw new Error(`Invalid relative path: ${relative}`);
}

function resolveRelativePath(
  base: ParsedCasUri,
  relative: ParsedRelativePath
): ParsedCasUri {
  if (relative.type === "path") {
    return {
      ...base,
      path: [...(base.path ?? []), ...(relative.path ?? [])],
      indexPath: undefined, // 忽略原有 index-path
    };
  }

  // type === "index"
  return {
    ...base,
    indexPath: [...(base.indexPath ?? []), ...(relative.indices ?? [])],
  };
}
```

---

## 附录 A: Crockford Base32

### A.1 字符集

```
0 1 2 3 4 5 6 7 8 9 A B C D E F G H J K M N P Q R S T V W X Y Z
```

**排除的字符**: I, L, O, U (避免与 1, 1, 0, V 混淆)

### A.2 编码

```typescript
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function crockfordEncode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}
```

### A.3 解码

```typescript
const CROCKFORD_DECODE: Record<string, number> = {};
CROCKFORD_ALPHABET.split("").forEach((c, i) => {
  CROCKFORD_DECODE[c] = i;
  CROCKFORD_DECODE[c.toLowerCase()] = i;
});
// 兼容映射
CROCKFORD_DECODE["O"] = CROCKFORD_DECODE["o"] = 0;
CROCKFORD_DECODE["I"] = CROCKFORD_DECODE["i"] = 1;
CROCKFORD_DECODE["L"] = CROCKFORD_DECODE["l"] = 1;

function crockfordDecode(str: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const result: number[] = [];

  for (const char of str) {
    const v = CROCKFORD_DECODE[char];
    if (v === undefined) {
      throw new Error(`Invalid character: ${char}`);
    }
    value = (value << 5) | v;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      result.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(result);
}
```

---

## 附录 B: 与现有实现的关系

### B.1 现有的 Key 格式

当前系统使用 `blake3s:` 前缀 + 32 位十六进制：

```
blake3s:04821167d026fa3b24e160b8f9f0ff2a
```

### B.2 与 CAS URI 的对应

```
blake3s:04821167d026fa3b24e160b8f9f0ff2a
   ↓
cas://node:0940GNXH0TWX6H70C2C4YY7ZP8
```

### B.3 迁移策略

1. CAS URI 作为外部 API 的标准格式
2. 内部存储继续使用 `blake3s:` 格式
3. 提供双向转换函数
