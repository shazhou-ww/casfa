# MCP 协议 API

CASFA 提供 MCP (Model Context Protocol) 兼容的 JSON-RPC 端点，让传统 MCP 客户端可以与 CAS 交互。

> **注意**: CASFA 实现的是 MCP 协议子集，仅支持 `tools` 能力。不支持 `resources/*`、`prompts/*` 和 `completion/*` 方法。

## 支持的能力

| 能力 | 支持状态 | 说明 |
|------|----------|------|
| `tools` | ✅ 支持 | CAS 操作工具（读写、Ticket 管理） |
| `resources` | ❌ 不支持 | 未实现 |
| `prompts` | ❌ 不支持 | 未实现 |
| `logging` | ❌ 不支持 | 未实现 |

## 端点

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/mcp` | MCP JSON-RPC 端点 | Agent/User Token |

## 认证

需要 Agent Token 或 User Token：

```http
Authorization: Agent {agentToken}
```

或

```http
Authorization: Bearer {userToken}
```

---

## MCP 协议

CASFA MCP 实现遵循 MCP 2024-11-05 协议版本。

### 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "方法名",
  "params": { ... }
}
```

### 响应格式

成功：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

错误：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "错误描述",
    "data": { ... }
  }
}
```

---

## MCP 方法

### initialize

初始化 MCP 会话。

#### 请求

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize"
}
```

#### 响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "cas-mcp",
      "version": "0.1.0"
    }
  }
}
```

---

### tools/list

列出可用的 MCP 工具。

#### 请求

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

#### 响应

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "cas_get_ticket",
        "description": "Get a CAS access ticket...",
        "inputSchema": { ... }
      },
      {
        "name": "cas_read",
        "description": "Read a blob from CAS...",
        "inputSchema": { ... }
      },
      {
        "name": "cas_write",
        "description": "Write a blob to CAS...",
        "inputSchema": { ... }
      }
    ]
  }
}
```

---

### tools/call

调用 MCP 工具。

#### 请求

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "工具名",
    "arguments": { ... }
  }
}
```

---

## MCP 工具

### cas_get_ticket

获取 CAS 访问 Ticket。

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `input` | `string \| string[]` | 输入节点 key(s) |
| `writable` | `boolean?` | 是否需要写入权限，默认 false |
| `expiresIn` | `number?` | 有效期（秒） |

#### 示例请求

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "cas_get_ticket",
    "arguments": {
      "input": "node:abc123...",
      "writable": true,
      "expiresIn": 3600
    }
  }
}
```

#### 示例响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"realmId\":\"user:A6JCHNMFWRT90AXMYWHJ8HKS90\",\"ticketId\":\"ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC\",\"input\":[\"node:abc123...\"],\"expiresAt\":1738501200000}"
      }
    ]
  }
}
```

> **访问方式**: Tool 使用返回的 `realmId` 和 `ticketId` 访问 Realm 路由，通过 `Authorization: Ticket {ticketId}` header 认证。

---

### cas_read

从 CAS 读取 Blob。

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `realmId` | `string` | Realm ID |
| `ticketId` | `string` | Ticket ID |
| `key` | `string` | CAS 节点 key |
| `path` | `string?` | 路径，默认 "."（节点本身） |

#### 示例请求

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "cas_read",
    "arguments": {
      "realmId": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
      "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "key": "node:abc123...",
      "path": "."
    }
  }
}
```

#### 示例响应

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"key\":\"node:abc123...\",\"contentType\":\"image/png\",\"size\":12345,\"content\":\"base64编码的内容...\"}"
      }
    ]
  }
}
```

---

### cas_write

向 CAS 写入 Blob。

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `realmId` | `string` | Realm ID |
| `ticketId` | `string` | 可写的 Ticket ID |
| `content` | `string` | Base64 编码的内容 |
| `contentType` | `string` | MIME 类型 |

#### 示例请求

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "cas_write",
    "arguments": {
      "realmId": "user:A6JCHNMFWRT90AXMYWHJ8HKS90",
      "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "content": "SGVsbG8gV29ybGQh",
      "contentType": "text/plain"
    }
  }
}
```

#### 示例响应

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"key\":\"node:def456...\",\"contentType\":\"text/plain\",\"size\":12}"
      }
    ]
  }
}
```

---

## 错误码

| 错误码 | 描述 |
|--------|------|
| -32700 | 解析错误 |
| -32600 | 无效请求 |
| -32601 | 方法不存在 |
| -32602 | 无效参数 |
| -32603 | 内部错误 |
