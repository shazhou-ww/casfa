# @casfa/protocol

CASFA（Content-Addressable Storage for Agents）协议定义。

本包提供共享的 Zod 模式和 TypeScript 类型，定义 CASFA API 契约，实现客户端与服务端之间的类型安全通信。

## 安装

```bash
bun add @casfa/protocol
```

## 使用方法

```typescript
import {
  // ID 校验
  UserIdSchema,
  TicketIdSchema,
  NodeKeySchema,
  
  // 请求/响应模式
  CreateTicketSchema,
  CreateDepotSchema,
  CheckNodesSchema,
  
  // 类型
  type UserRole,
  type TicketStatus,
  type NodeKind,
} from '@casfa/protocol';

// 校验 ticket 创建请求
const result = CreateTicketSchema.safeParse(requestBody);
if (result.success) {
  // result.data 已正确类型化
}
```

## 内容

### ID 格式

所有 128 位标识符使用 Crockford Base32 编码（26 字符）：

| 类型 | 格式 | 示例 |
|------|------|------|
| User ID | `user:{base32}` | `user:A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Ticket ID | `ticket:{ulid}` | `ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Depot ID | `depot:{ulid}` | `depot:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Node Key | `node:{blake3}` | `node:abc123...`（64 个十六进制字符） |
| Token ID | `token:{blake3s}` | `token:A6JCHNMFWRT90AXMYWHJ8HKS90` |

### 模式

- **Auth**：`CreateTicketSchema`、`CreateAgentTokenSchema`、`AwpAuthInitSchema` 等
- **Admin**：`UpdateUserRoleSchema`
- **Ticket**：`TicketCommitSchema`、`ListTicketsQuerySchema`
- **Depot**：`CreateDepotSchema`、`UpdateDepotSchema`、`DepotCommitSchema`
- **Node**：`CheckNodesSchema`、`NodeMetadataSchema`

### 类型

- `UserRole`：`"unauthorized" | "authorized" | "admin"`
- `TicketStatus`：`"issued" | "committed" | "revoked" | "archived"`
- `NodeKind`：`"dict" | "file" | "successor"`

## 许可证

MIT
