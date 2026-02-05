# @casfa/cas-uri

CASFA 内容寻址存储的 CAS URI 解析与格式化工具。

## 安装

```bash
bun add @casfa/cas-uri
```

## 概述

本包提供 CAS URI 的解析和格式化工具，用于在 CASFA 系统中唯一标识内容。

### CAS URI 格式

```
{root}[/path...][#index-path]
```

其中 `root` 可以是：
- `node:{hash}` - 直接引用 CAS 节点（53 字符十六进制）
- `depot:{ulid}` - 引用 depot
- `ticket:{ulid}` - 引用 ticket

## 使用方法

### 解析 URI

```typescript
import { parseCasUri, parseCasUriOrThrow } from '@casfa/cas-uri';

// 安全解析（返回结果对象）
const result = parseCasUri('node:abc123.../path/to/file');
if (result.success) {
  console.log(result.value.root);  // { type: 'node', id: 'abc123...' }
  console.log(result.value.path);  // ['path', 'to', 'file']
}

// 抛异常方式
const uri = parseCasUriOrThrow('depot:01HQXK5V8N3Y7M2P4R6T9W0ABC/data');
```

### 创建 URI

```typescript
import { nodeUri, depotUri, ticketUri, formatCasUri } from '@casfa/cas-uri';

// 使用辅助函数创建 URI
const node = nodeUri('abc123...', ['path', 'to', 'file']);
const depot = depotUri('01HQXK5V8N3Y7M2P4R6T9W0ABC');
const ticket = ticketUri('01HQXK5V8N3Y7M2P4R6T9W0ABC', ['subpath']);

// 或使用通用函数
const uri = formatCasUri({
  root: { type: 'node', id: 'abc123...' },
  path: ['path', 'to', 'file'],
});
```

### 路径操作

```typescript
import {
  appendPath,
  parentUri,
  rootUri,
  basename,
  resolvePath,
  isAncestorOf,
  uriEquals,
  withIndexPath,
} from '@casfa/cas-uri';

const uri = parseCasUriOrThrow('node:abc123.../a/b/c');

// 路径导航
const parent = parentUri(uri);       // node:abc123.../a/b
const root = rootUri(uri);           // node:abc123...
const name = basename(uri);          // 'c'

// 路径修改
const extended = appendPath(uri, ['d', 'e']);  // node:abc123.../a/b/c/d/e
const resolved = resolvePath(uri, '../x');      // node:abc123.../a/b/x

// URI 比较
isAncestorOf(parent, uri);  // true
uriEquals(uri, uri);        // true

// 索引路径（用于 dict 查找）
const indexed = withIndexPath(uri, ['meta', 'info']);  // node:abc123.../a/b/c#meta/info
```

## API 参考

### 类型

- `CasUri` - 解析后的 CAS URI 结构
- `CasUriRoot` - 根标识符（node、depot 或 ticket）
- `CasUriRootType` - 联合类型：`'node' | 'depot' | 'ticket'`
- `CasUriParseResult` - 解析操作的结果类型
- `CasUriParseError` - 解析失败的错误类型

### 常量

- `ROOT_TYPES` - 有效的根类型字符串
- `CROCKFORD_BASE32_26` - 26 字符 Crockford Base32 正则
- `PATH_SEGMENT_REGEX` - 有效路径段的匹配模式

## 许可证

MIT
