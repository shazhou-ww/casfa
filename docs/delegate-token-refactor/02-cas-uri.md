# CAS URI 规范

> 版本: 2.0  
> 日期: 2026-02-15

---

## 目录

1. [概述](#1-概述)
2. [URI 格式](#2-uri-格式)
3. [Root 类型](#3-root-类型)
4. [Segment 语义](#4-segment-语义)
5. [Relative Path](#5-relative-path)
6. [URI 解析与格式化](#6-uri-解析与格式化)

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
| **分层结构** | 支持 root + segments（name/index 混合）多层定位 |
| **HTTP 友好** | 全部信息在 URL path 中，不依赖 fragment（`#`）|
| **相对寻址** | 支持相对于上下文的简化表示 |
| **自顶向下** | 解析时自顶向下，任何一级不存在则整个路径无效 |

---

## 2. URI 格式

### 2.1 完整格式

```
cas://root[/segment...]
```

**组成部分**:

| 部分 | 必选 | 说明 |
|------|------|------|
| `cas://` | 是 | 协议前缀 |
| `root` | 是 | 根节点标识 |
| `/segment` | 否 | 路径段，可以是 name 段或 `~N` index 段 |

### 2.2 示例

```
# 仅 root
cas://depot:4XZRT7Y2M5K9BQWP

# root + name path
cas://depot:4XZRT7Y2M5K9BQWP/src/main.ts

# root + index path
cas://node:ABCD1234EFGH5678/~0/~2/~1

# root + name + index（先按名称再按索引）
cas://depot:4XZRT7Y2M5K9BQWP/src/~0/~1

# root + index + name（先按索引再按名称，旧 # 语法做不到）
cas://depot:4XZRT7Y2M5K9BQWP/~1/utils/helper.ts
```

### 2.3 语法定义 (ABNF)

```abnf
cas-uri       = "cas://" root *( "/" segment )

root          = root-type ":" root-id
root-type     = "node" / "depot"
root-id       = 1*base32-char

segment       = name-segment / index-segment
name-segment  = 1*pchar       ; 符合 RFC 3986 的路径段（不以 ~ 开头）
index-segment = "~" 1*DIGIT   ; ~ 前缀 + 非负整数

base32-char   = "0" / "1" / "2" / "3" / "4" / "5" / "6" / "7" / "8" / "9"
              / "A" / "B" / "C" / "D" / "E" / "F" / "G" / "H" 
              / "J" / "K" / "M" / "N" / "P" / "Q" / "R" / "S" 
              / "T" / "V" / "W" / "X" / "Y" / "Z"
                     ; Crockford Base32 字符集 (排除 I, L, O, U)
```

### 2.4 为什么用 `~` 前缀替代 `#` 分隔符

旧格式 `cas://root/path#index-path` 存在以下问题：

| 问题 | 说明 |
|------|------|
| **HTTP fragment 不发送** | `#` 后的内容是 URI fragment，浏览器不会发送到服务器 |
| **无法混合导航** | `#` 是终结符，无法在 index 段之后再接 name 段 |
| **RESTful 不友好** | 无法直接映射到 URL path |

新格式用 `~` 前缀标记 index 段，所有段都在 URL path 中：
- `~` 是 URL 非保留字符，会被完整发送到服务器
- name 段和 index 段可以自由混合交替
- 文件名以 `~` 开头极罕见，冲突时可 URL encode 为 `%7E`

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

## 4. Segment 语义

CAS URI 的路径由 segment 序列组成，每个 segment 可以是 **name 段** 或 **index 段**，二者可以自由混合交替。

### 4.1 Name 段

Name 段基于 d-node (目录节点) 的 children names 导航，类似于文件系统路径。

**格式**: 不以 `~` 开头的路径段

**规则**:
- 每个 segment 对应 d-node 的一个 child name
- segment 使用 UTF-8 编码
- 特殊字符需要 URL 编码
- 以 `~` 开头的文件名需要 URL encode 为 `%7E` 以避免与 index 段混淆

**示例**:

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

### 4.2 Index 段

Index 段基于节点 children 列表中的位置索引导航，用于精确且紧凑地定位子节点。

**格式**: `~N`（`~` 前缀 + 非负整数）

**规则**:
- 以 `~` 开头，后跟非负整数
- 索引从 0 开始
- 适用于所有有 children 的节点（d-node、f-node 等）

**示例**:

给定目录结构（children 按 UTF-8 字节序排列）：

```
root (d-node, children: [README.md, src])
├── README.md (index 0)
└── src (index 1, children: [main.ts, utils])
    ├── main.ts (index 0)
    └── utils (index 1, children: [helper.ts])
        └── helper.ts (index 0)
```

| 目标节点 | CAS URI | 等效 name path |
|----------|---------|---------------|
| root | `cas://depot:XXX` | — |
| README.md | `cas://depot:XXX/~0` | `/README.md` |
| src | `cas://depot:XXX/~1` | `/src` |
| main.ts | `cas://depot:XXX/~1/~0` | `/src/main.ts` |
| utils | `cas://depot:XXX/~1/~1` | `/src/utils` |
| helper.ts | `cas://depot:XXX/~1/~1/~0` | `/src/utils/helper.ts` |

### 4.3 混合段

Name 段和 Index 段可以自由混合，这是 `~` 前缀方案相比旧 `#` 分隔方案的关键优势。

```
# 先 name 再 index
cas://depot:XXX/src/~0/~1

# 先 index 再 name（旧 # 语法做不到！）
cas://depot:XXX/~1/utils/helper.ts

# 交替出现
cas://depot:XXX/src/~0/lib/~2
```

### 4.4 Index 段的优势

| 优势 | 说明 |
|------|------|
| **紧凑** | 数字比名称更短 |
| **确定性** | 不受名称重命名影响 |
| **验证友好** | 易于验证子节点属于父节点 |
| **适合授权** | Token scope 验证使用 index 段 |
| **可穿透** | 可以从 f-node 继续向下索引到 c-node（内容块）|
| **HTTP 友好** | 所有信息在 URL path 中，对服务器完全可见 |

### 4.5 Index 段穿透 f-node

Index 段不仅可以遍历 d-node 的 children，还可以穿透 f-node 访问其内容块（c-node）：

```
f-node (文件节点)
├── c-node[0] (第一个内容块)
├── c-node[1] (第二个内容块)
└── c-node[2] (第三个内容块)
```

例如 `~1/~0/~2` 可以表示：根节点的第 1 个 child（f-node），该 f-node 的第 0 个子节点，再向下第 2 个。

### 4.6 Segment 解析

```typescript
import type { PathSegment } from '@casfa/cas-uri';

async function resolveSegments(
  rootHash: Uint8Array,
  segments: PathSegment[],
  storage: StorageProvider
): Promise<Uint8Array> {
  let currentHash = rootHash;

  for (const seg of segments) {
    const node = await storage.get(hashToKey(currentHash));
    if (!node) throw new Error("Node not found");
    const decoded = decodeNode(node);

    if (seg.kind === "name") {
      // Name 段：在 d-node 的 childNames 中查找
      if (decoded.kind !== "dict") {
        throw new Error("Cannot traverse non-dict node by name");
      }
      const childIndex = decoded.childNames?.indexOf(seg.value);
      if (childIndex === undefined || childIndex === -1) {
        throw new Error(`Child "${seg.value}" not found`);
      }
      currentHash = decoded.children![childIndex];
    } else {
      // Index 段：按 children 索引访问
      if (!decoded.children || seg.value >= decoded.children.length) {
        throw new Error(`Child index ${seg.value} out of bounds`);
      }
      currentHash = decoded.children[seg.value];
    }
  }

  return currentHash;
}
```

---

## 5. Relative Path

### 5.1 定义

在有上下文（如 Token scope）的情况下，可以使用相对路径简化 URI 表示。

### 5.2 类型

| 前缀 | 类型 | 说明 |
|------|------|------|
| `./` | Name 相对 | 追加 name 段 |
| `./~N` | Index 相对 | 追加 index 段 |

由于 name 段和 index 段现在统一在路径中，相对路径也可以自由混合：

**示例**:

| 上下文 | 相对路径 | 解析结果 |
|--------|----------|----------|
| `cas://depot:X/src` | `./utils` | `cas://depot:X/src/utils` |
| `cas://depot:X/src` | `./~0/~1` | `cas://depot:X/src/~0/~1` |
| `cas://depot:X/~1` | `./utils` | `cas://depot:X/~1/utils` |
| `cas://depot:X/~1` | `./~0` | `cas://depot:X/~1/~0` |

### 5.3 转签发中的相对路径

转签发时使用 relative path 限定子 scope：

```
父 Token scope: cas://depot:X (root)
转签发参数: ["./~1", "./~0"]  
新 Token scope: [cas://depot:X/~1, cas://depot:X/~0]
```

这样新 Token 只能访问 root 的第 0 和第 1 个子节点。

---

## 6. URI 解析与格式化

### 6.1 解析流程

```
┌─────────────────────────────────────────────────────────────┐
│                     URI 解析流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 验证协议前缀 "cas://"（可选）                             │
│                    │                                         │
│                    ▼                                         │
│  2. 解析 Root (type:id)                                      │
│     ├── node: → 直接使用 hash                                │
│     └── depot: → 查询数据库获取 root                         │
│                    │                                         │
│                    ▼                                         │
│  3. 逐段解析 Segments                                        │
│     ├── name 段 → 在 d-node 中按名称查找 child               │
│     └── ~N 段  → 按 children 索引定位                        │
│                    │                                         │
│                    ▼                                         │
│  4. 返回最终节点 hash                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 TypeScript 类型定义

```typescript
/**
 * 路径段
 */
type PathSegment =
  | { kind: "name"; value: string }
  | { kind: "index"; value: number };

/**
 * 解析后的 CAS URI
 */
type ParsedCasUri = {
  /** Root 类型 */
  rootType: "node" | "depot";
  /** Root ID (base32 字符串) */
  rootId: string;
  /** 路径段序列（name 段和 index 段混合） */
  segments: PathSegment[];
};
```

### 6.3 解析实现

```typescript
const INDEX_SEGMENT_REGEX = /^~(\d+)$/;

function parseSegment(raw: string): PathSegment {
  const match = raw.match(INDEX_SEGMENT_REGEX);
  if (match) {
    return { kind: "index", value: parseInt(match[1], 10) };
  }
  return { kind: "name", value: decodeURIComponent(raw) };
}

function parseCasUri(uri: string): ParsedCasUri {
  // 去掉可选的 cas:// 前缀
  const stripped = uri.replace(/^cas:\/\//, "");
  const parts = stripped.split("/");
  const [rootType, rootId] = parts[0].split(":");

  if (!["node", "depot"].includes(rootType.toLowerCase())) {
    throw new Error(`Unknown root type: ${rootType}`);
  }

  const segments = parts.slice(1)
    .filter(s => s.length > 0)
    .map(parseSegment);

  return {
    rootType: rootType.toLowerCase() as "node" | "depot",
    rootId: rootId.toUpperCase(),
    segments,
  };
}
```

### 6.4 格式化实现

```typescript
function formatSegment(seg: PathSegment): string {
  return seg.kind === "index"
    ? `~${seg.value}`
    : encodeURIComponent(seg.value);
}

function formatCasUri(parsed: ParsedCasUri): string {
  let uri = `cas://${parsed.rootType}:${parsed.rootId}`;

  if (parsed.segments.length > 0) {
    uri += "/" + parsed.segments.map(formatSegment).join("/");
  }

  return uri;
}
```

### 6.5 相对路径解析

```typescript
function resolveRelativePath(
  base: ParsedCasUri,
  relative: string
): ParsedCasUri {
  if (!relative.startsWith("./")) {
    throw new Error(`Invalid relative path: ${relative}`);
  }

  const relSegments = relative.slice(2)
    .split("/")
    .filter(s => s.length > 0)
    .map(parseSegment);

  return {
    ...base,
    segments: [...base.segments, ...relSegments],
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
