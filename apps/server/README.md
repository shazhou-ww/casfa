# @casfa/server

CASFA Server - Content-Addressable Storage for Agents.

> **Note**: This package is private and not published to npm. It's meant to be deployed as a standalone service.

## Features

- 🔐 **Delegate Token Model**: Three-tier token hierarchy (JWT → Delegate Token → Access Token)
- 📦 **Content-Addressable Storage**: BLAKE3-based CAS system
- 🏠 **Realm Isolation**: Independent storage space per user
- 🎫 **Ticket System**: Fine-grained temporary access control
- 📁 **Depot Management**: Git-like versioned data storage
- 🔄 **Multiple Storage Backends**: S3, File System, Memory
- 🤖 **MCP Support**: Model Context Protocol integration

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/) (for DynamoDB Local)

### Start Development Server

```bash
# From repository root
cd apps/server

# Option 1: Use CLI tool (recommended)
bun run dev                   # Default: persistent DB + fs storage + mock auth

# Option 2: Use preset modes
bun run dev:minimal          # All in-memory, no Docker (quick testing)
bun run dev:docker           # Persistent DynamoDB + file storage (local dev)
bun run dev:aws              # Connect to AWS services (integration testing)

# Option 3: Direct server
bun run dev:simple           # Run server.ts directly
```

### Verify Service

```bash
curl http://localhost:8801/api/health
# {"status":"healthy"}

curl http://localhost:8801/api/info
# {"service":"casfa","version":"0.2.0",...}
```

## Development Modes

| Mode | Command | DynamoDB | Storage | Auth | Use Case |
|------|---------|----------|---------|------|----------|
| **minimal** | `dev:minimal` | Memory (8701) | Memory | Mock JWT | E2E tests, quick validation |
| **docker** | `dev:docker` | Persistent (8700) | File System | Mock JWT | Daily development |
| **aws** | `dev:aws` | AWS | S3 | Cognito | Integration testing |

### DynamoDB Ports

| Port | Container | Mode | Purpose |
|------|-----------|------|---------|
| **8700** | `dynamodb` | Persistent | Development, data retained |
| **8701** | `dynamodb-test` | In-memory | E2E tests, clean each run |

## Commands

```bash
# Development
bun run dev              # Start dev server (CLI tool)
bun run dev:simple       # Start server directly
bun run dev:setup        # One-click dev environment setup

# Testing
bun run test:unit        # Run unit tests
bun run test:e2e         # Run E2E tests (auto-manages containers)
bun run test:e2e:debug   # E2E tests (keep containers for debugging)

# Database
bun run db:create        # Create tables (port 8700)
bun run db:create:test   # Create tables (port 8701)
bun run db:delete        # Delete tables

# Build & Deploy
bun run build            # Build Lambda deployment package
bun run sam:build        # SAM build
bun run sam:deploy       # Deploy to AWS

# Code Quality
bun run check            # TypeScript + Biome lint
bun run lint:fix         # Auto-fix lint issues
```

## Project Structure

```
apps/server/
├── .env.example          # Environment template
├── package.json
├── tsconfig.json
└── backend/
    ├── server.ts         # Local dev server entry
    ├── e2e/              # E2E tests
    │   ├── setup.ts
    │   ├── admin.test.ts
    │   ├── auth.test.ts
    │   ├── client-auth.test.ts
    │   ├── depots.test.ts
    │   ├── health.test.ts
    │   ├── nodes.test.ts
    │   ├── realm.test.ts
    │   ├── tickets.test.ts
    │   └── tokens.test.ts
    ├── scripts/
    │   ├── build.ts
    │   ├── create-local-tables.ts
    │   ├── dev-setup.ts
    │   ├── dev.ts
    │   ├── integration-test.ts
    │   └── set-admin.ts
    ├── tests/            # Unit tests
    └── src/
        ├── app.ts        # Hono app factory
        ├── bootstrap.ts  # Dependency initialization
        ├── config.ts     # Configuration loading
        ├── handler.ts    # Lambda entry point
        ├── router.ts     # API route definitions
        ├── types.ts      # Type definitions
        ├── auth/         # Authentication
        ├── controllers/  # Request handlers
        ├── db/           # DynamoDB data access
        ├── mcp/          # MCP protocol handler
        ├── middleware/   # Hono middleware
        ├── schemas/      # Zod validation schemas
        ├── services/     # Business logic
        └── util/         # Utilities
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT_CASFA_V2_API` | 8801 | API server port |
| `DYNAMODB_ENDPOINT` | http://localhost:8700 | DynamoDB endpoint |
| `STORAGE_TYPE` | memory | Storage: memory / fs / s3 |
| `STORAGE_FS_PATH` | ./data | File storage path (when STORAGE_TYPE=fs) |
| `MOCK_JWT_SECRET` | - | Mock JWT secret (local dev) |
| `COGNITO_USER_POOL_ID` | - | Cognito config (production) |

See [.env.example](.env.example) for complete configuration.

## API Overview

### Service

- `GET /api/health` - Health check
- `GET /api/info` - Service info (storage type, auth method, limits)

### OAuth

- `GET /api/oauth/config` - OAuth configuration
- `POST /api/oauth/login` - User login
- `POST /api/oauth/refresh` - Refresh tokens
- `POST /api/oauth/token` - Token exchange
- `GET /api/oauth/me` - Current user info (JWT required)

### Delegate Tokens

- `POST /api/tokens` - Create delegate token (JWT required)
- `GET /api/tokens` - List tokens (JWT required)
- `GET /api/tokens/:tokenId` - Get token details (JWT required)
- `POST /api/tokens/:tokenId/revoke` - Revoke token (JWT required)
- `POST /api/tokens/delegate` - Re-delegate token (Delegate Token required)

### Token Requests (Client Authorization Flow)

- `POST /api/tokens/requests` - Create authorization request
- `GET /api/tokens/requests/:requestId/poll` - Poll request status
- `GET /api/tokens/requests` - List pending requests (JWT required)
- `POST /api/tokens/requests/:requestId/approve` - Approve request (JWT required)
- `POST /api/tokens/requests/:requestId/reject` - Reject request (JWT required)

### Realm (Access Token required)

- `GET /api/realm/:realmId` - Get realm info
- `GET /api/realm/:realmId/usage` - Get usage statistics

### Tickets

- `POST /api/realm/:realmId/tickets` - Create ticket
- `GET /api/realm/:realmId/tickets` - List tickets
- `GET /api/realm/:realmId/tickets/:ticketId` - Get ticket details
- `POST /api/realm/:realmId/tickets/:ticketId/submit` - Submit ticket result
- `POST /api/realm/:realmId/tickets/:ticketId/revoke` - Revoke ticket
- `DELETE /api/realm/:realmId/tickets/:ticketId` - Delete ticket

### Nodes (CAS)

- `POST /api/realm/:realmId/nodes/prepare` - Prepare node upload
- `PUT /api/realm/:realmId/nodes/:key` - Upload node
- `GET /api/realm/:realmId/nodes/:key` - Get node content
- `GET /api/realm/:realmId/nodes/:key/metadata` - Get node metadata

### Depots

- `GET /api/realm/:realmId/depots` - List depots
- `POST /api/realm/:realmId/depots` - Create depot
- `GET /api/realm/:realmId/depots/:depotId` - Get depot details
- `PATCH /api/realm/:realmId/depots/:depotId` - Update depot
- `DELETE /api/realm/:realmId/depots/:depotId` - Delete depot
- `POST /api/realm/:realmId/depots/:depotId/commit` - Commit new version

### Admin

- `GET /api/admin/users` - List users (Admin required)
- `PATCH /api/admin/users/:userId` - Update user role (Admin required)

### MCP

- `POST /api/mcp` - MCP protocol endpoint (JWT required)

## Testing

E2E tests automatically manage DynamoDB container lifecycle:

```bash
bun run test:e2e
```

This will:
1. Start `dynamodb-test` container (port 8701, in-memory)
2. Wait for DynamoDB ready
3. Create test tables
4. Run all E2E tests
5. Clean up tables and storage
6. Stop and remove container

Debug mode (keep containers):
```bash
bun run test:e2e:debug
```

## Deployment

### AWS SAM

```bash
bun run sam:build
bun run sam:deploy
```

### Manual

```bash
bun run build
# Output: backend/dist/handler.mjs
```

## Related Documentation

- [CAS Binary Format](../../docs/CAS_BINARY_FORMAT.md)
- [CASFA API Docs](../../docs/casfa-api/)
- [Delegate Token Refactor](../../docs/delegate-token-refactor/)

## License

MIT
