# @casfa/protocol

CASFA (Content-Addressable Storage for Agents) protocol definitions.

This package provides shared Zod schemas and TypeScript types for the CASFA API contract, enabling type-safe communication between clients and the server.

## Installation

```bash
bun add @casfa/protocol
```

## Usage

```typescript
import {
  // ID validation
  UserIdSchema,
  TicketIdSchema,
  NodeKeySchema,
  
  // Request/Response schemas
  CreateTicketSchema,
  CreateDepotSchema,
  PrepareNodesSchema,
  
  // Types
  type UserRole,
  type TicketStatus,
  type NodeKind,
} from '@casfa/protocol';

// Validate a ticket creation request
const result = CreateTicketSchema.safeParse(requestBody);
if (result.success) {
  // result.data is properly typed
}
```

## Contents

### ID Formats

All 128-bit identifiers use Crockford Base32 encoding (26 characters):

| Type | Format | Example |
|------|--------|---------|
| User ID | `user:{base32}` | `user:A6JCHNMFWRT90AXMYWHJ8HKS90` |
| Ticket ID | `ticket:{ulid}` | `ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Depot ID | `depot:{ulid}` | `depot:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Node Key | `node:{blake3}` | `node:abc123...` (64 hex chars) |
| Token ID | `token:{blake3s}` | `token:A6JCHNMFWRT90AXMYWHJ8HKS90` |

### Schemas

- **Auth**: `CreateTicketSchema`, `CreateAgentTokenSchema`, `AwpAuthInitSchema`, etc.
- **Admin**: `UpdateUserRoleSchema`
- **Ticket**: `TicketCommitSchema`, `ListTicketsQuerySchema`
- **Depot**: `CreateDepotSchema`, `UpdateDepotSchema`, `DepotCommitSchema`
- **Node**: `PrepareNodesSchema`, `NodeMetadataSchema`

### Types

- `UserRole`: `"unauthorized" | "authorized" | "admin"`
- `TicketStatus`: `"issued" | "committed" | "revoked" | "archived"`
- `NodeKind`: `"dict" | "file" | "successor"`
