# @casfa/client

CASFA client library with unified authorization strategies.

## Installation

```bash
bun add @casfa/client
```

## Overview

A stateful client that manages the three-tier token hierarchy:

1. **User JWT** - OAuth login token, highest authority
2. **Delegate Token** - Re-delegation token, can issue child tokens
3. **Access Token** - Data access token, used for CAS operations

## Quick Start

```typescript
import { createClient } from '@casfa/client';

const client = createClient({
  baseUrl: 'https://api.casfa.example.com',
  onAuthRequired: async () => {
    // Handle authentication (e.g., redirect to login)
  },
  onTokenChange: (state) => {
    // Persist token state
    localStorage.setItem('casfa-tokens', JSON.stringify(state));
  },
});

// Initialize with stored tokens
const stored = localStorage.getItem('casfa-tokens');
if (stored) {
  client.tokens.restore(JSON.parse(stored));
}
```

## Features

### OAuth Authentication

```typescript
// Start OAuth flow
const { authUrl, state, codeVerifier } = await client.oauth.startAuth({
  redirectUri: 'https://myapp.com/callback',
});

// Handle callback
const tokens = await client.oauth.handleCallback({
  code: authCode,
  codeVerifier,
  redirectUri: 'https://myapp.com/callback',
});
```

### Token Management

```typescript
// Check token status
const hasValidTokens = client.tokens.hasValidTokens();
const userToken = client.tokens.getUserToken();
const delegateToken = client.tokens.getDelegateToken();
const accessToken = client.tokens.getAccessToken();

// Refresh tokens
await client.tokens.refresh();

// Clear all tokens (logout)
client.tokens.clear();
```

### Depot Operations

```typescript
// List depots
const depots = await client.depots.list();

// Create depot
const depot = await client.depots.create({
  name: 'my-depot',
  description: 'My storage depot',
});

// Get depot info
const info = await client.depots.get(depotId);
```

### Ticket Operations

```typescript
// Create access ticket
const ticket = await client.tickets.create({
  depotId: 'depot:...',
  permissions: ['read', 'write'],
  expiresIn: 3600,
});

// List tickets
const tickets = await client.tickets.list({ depotId: 'depot:...' });

// Revoke ticket
await client.tickets.revoke(ticketId);
```

### Node Operations (CAS)

```typescript
// Read node data
const data = await client.nodes.get('node:abc123...');

// Put node data
const key = await client.nodes.put(data);

// Check if node exists
const exists = await client.nodes.has('node:abc123...');

// Prepare upload (for large files)
const { uploadUrl } = await client.nodes.prepare({
  size: fileSize,
  hash: computedHash,
});
```

## Configuration

```typescript
interface ClientConfig {
  // Required
  baseUrl: string;
  
  // Callbacks
  onAuthRequired?: () => void | Promise<void>;
  onTokenChange?: (state: TokenState) => void;
  
  // Optional storage provider (for CAS operations)
  storage?: StorageProvider;
  
  // Timeouts and retries
  timeout?: number;
  retries?: number;
}
```

## Token Store

The client includes a sophisticated token store that handles:

- Automatic token refresh before expiry
- Token hierarchy validation
- Issuer chain tracking
- Concurrent refresh protection

```typescript
import {
  createTokenStore,
  createRefreshManager,
  isTokenValid,
  isTokenExpiringSoon,
} from '@casfa/client';

// Create standalone token store
const store = createTokenStore();

// Create refresh manager
const refreshManager = createRefreshManager(store, {
  refreshThreshold: 5 * 60 * 1000, // 5 minutes before expiry
});
```

## API Module

For advanced usage, access the raw API functions:

```typescript
import { api } from '@casfa/client';

// Direct API calls
const result = await api.createTicket(baseUrl, token, params);
```

## Types

```typescript
import type {
  CasfaClient,
  ClientConfig,
  ClientError,
  TokenState,
  StoredUserToken,
  StoredDelegateToken,
  StoredAccessToken,
} from '@casfa/client';
```

## License

MIT
