# CASFA

CASFA (Content-Addressable Storage for Agents) - A monorepo for CASFA packages and applications.

## Packages

| Package | Description |
|---------|-------------|
| `@casfa/protocol` | Protocol definitions with Zod schemas and TypeScript types |
| `@casfa/core` | CAS binary format encoding/decoding - B-Tree node structure |
| `@casfa/storage-core` | Core types and utilities for storage providers |
| `@casfa/storage-fs` | File system storage provider |
| `@casfa/storage-memory` | In-memory storage provider (for testing) |
| `@casfa/storage-s3` | S3 storage provider |
| `@casfa/auth` | Authentication middleware (OAuth 2.1, HMAC, API Key) |
| `@casfa/client` | Client library with unified authorization strategies |

## Applications

| App | Description |
|-----|-------------|
| `@casfa/server` | CASFA Server - Backend API with Hono |
| `@casfa/cli` | CASFA CLI - Command-line interface |

## Development

```bash
# Install dependencies
bun install --no-cache

# Type check all packages
bun run typecheck

# Lint check
bun run lint

# Fix lint issues
bun run lint:fix

# Run all checks
bun run check
```

## Server Development

```bash
# Start development server
cd apps/server && bun run dev

# Run tests
cd apps/server && bun run test
```

## Documentation

- [CAS Binary Format Specification](./docs/CAS_BINARY_FORMAT.md) - CAS 二进制格式规范
- [CASFA API Documentation](./docs/casfa-api/) - API 文档

## Structure

```
casfa/
├── docs/               # 文档
│   ├── CAS_BINARY_FORMAT.md
│   └── casfa-api/
├── packages/
│   ├── protocol/       # @casfa/protocol
│   ├── core/           # @casfa/core
│   ├── storage-core/   # @casfa/storage-core
│   ├── storage-fs/     # @casfa/storage-fs
│   ├── storage-memory/ # @casfa/storage-memory
│   ├── storage-s3/     # @casfa/storage-s3
│   ├── auth/           # @casfa/auth
│   └── client/         # @casfa/client
├── apps/
│   ├── server/         # @casfa/server
│   └── cli/            # @casfa/cli
├── biome.json          # Shared Biome config
├── tsconfig.json       # Shared TypeScript config
└── package.json        # Workspace config
```
