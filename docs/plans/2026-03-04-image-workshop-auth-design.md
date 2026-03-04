# Image Workshop Auth & Delegate System Design

## Goal

Add Cognito login (Google/Microsoft) and Delegate token system to image-workshop.
Two token types: User Token (Cognito JWT, can issue Delegates) and Delegate Token
(limited permissions, supports refresh). All MCP access requires a valid token.

## Token Types

| Token | Format | Source | Capabilities |
|-------|--------|--------|-------------|
| User Token | Cognito JWT | Cognito OAuth login | All permissions, can issue Delegates |
| Delegate Token | `base64(payload).base64(sig)` | Frontend creation or MCP OAuth | Per `permissions` field |

## Permissions

Two permissions, simplified from server-next:

- `use_mcp` — can call MCP tools
- `manage_delegates` — can create/list/revoke Delegates

User Token implicitly has both. Delegate Token has only what was granted at creation.

## Delegate ID Format

`dlg_` + Crockford Base32 encoded 128-bit UUID, e.g. `dlg_01H5QG3KXRJY8N4WZV7P6M2E9A`.

## DynamoDB Table: `image-workshop-grants`

| Attribute | Type | Description |
|-----------|------|-------------|
| `pk` | S | `GRANT#{delegateId}` |
| `sk` | S | `METADATA` |
| `gsi1pk` | S | `USER#{userId}` |
| `gsi1sk` | S | `HASH#{accessTokenHash}` |
| `gsi2pk` | S | `USER#{userId}` |
| `gsi2sk` | S | `REFRESH#{refreshTokenHash}` |
| `delegateId` | S | `dlg_...` |
| `userId` | S | Cognito sub |
| `clientName` | S | e.g. "Claude Desktop" |
| `permissions` | L | `["use_mcp"]` or `["use_mcp", "manage_delegates"]` |
| `accessTokenHash` | S | SHA-256(accessToken) |
| `refreshTokenHash` | S | SHA-256(refreshToken), optional |
| `createdAt` | N | epoch ms |
| `expiresAt` | N | epoch ms for access_token, null if refresh-based |

### GSI

- **user-hash-index**: `gsi1pk` + `gsi1sk` — lookup by userId + accessTokenHash
- **user-refresh-index**: `gsi2pk` + `gsi2sk` — lookup by userId + refreshTokenHash

## Auth Middleware

```
Request → read Authorization: Bearer <token>
  │
  ├─ JWT (contains ".") → JWKS/mock verify, extract sub as userId
  │   SHA-256(token) → query user-hash-index
  │   ├─ found grant → DelegateAuth { userId, delegateId, permissions }
  │   └─ not found  → UserAuth { userId }
  │
  ├─ Non-JWT → parse payload, extract userId
  │   SHA-256(token) → query user-hash-index
  │   ├─ found grant → DelegateAuth
  │   └─ not found  → 401
  │
  └─ No token → 401
```

### Auth Types

```typescript
type UserAuth = { type: "user"; userId: string };
type DelegateAuth = { type: "delegate"; userId: string; delegateId: string; permissions: string[] };
type Auth = UserAuth | DelegateAuth;
```

### Mock Mode

When `MOCK_JWT_SECRET` env var is set, use HS256 verification instead of Cognito JWKS.
Frontend uses `VITE_MOCK_JWT_SECRET` to sign mock JWT client-side.

## API Routes

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/oauth-authorization-server` | OAuth discovery metadata |
| GET | `/oauth/authorize` | Redirect to Cognito |
| POST | `/oauth/token` | Exchange code or refresh token |

### Delegate Management (requires `manage_delegates`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/delegates` | List current user's delegates |
| POST | `/api/delegates` | Create delegate |
| POST | `/api/delegates/:id/revoke` | Revoke delegate |

### MCP (requires `use_mcp`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp` | MCP Streamable HTTP |

### `/oauth/token` Behavior

**`grant_type=authorization_code`**:
- Without `scope=delegate`: proxy to Cognito, return Cognito JWT (frontend User Token)
- With `scope=delegate`: verify identity via Cognito, then mint and return Delegate Token

**`grant_type=refresh_token`**:
- Cognito refresh_token → proxy to Cognito
- Delegate refresh_token → rotate accessToken + refreshToken in grant store

### `POST /api/delegates`

Request:
```json
{ "clientName": "Claude Desktop", "permissions": ["use_mcp"], "ttl": 86400000 }
```

Response:
```json
{
  "delegateId": "dlg_01H5QG3KXRJY8N4WZV7P6M2E9A",
  "clientName": "Claude Desktop",
  "accessToken": "...",
  "refreshToken": "...",
  "permissions": ["use_mcp"],
  "expiresAt": 1772707200000
}
```

`ttl` is access_token lifetime in ms (default 24h). refresh_token is always issued.

## Authentication Flows

**Frontend login**: `/oauth/authorize` → Cognito → callback → `POST /oauth/token` → Cognito JWT

**MCP client (OAuth)**: discover via `/.well-known/...` → `/oauth/authorize?scope=delegate` → Cognito → callback → `POST /oauth/token` → Delegate Token

**Manual creation**: login via frontend → `POST /api/delegates` → copy token to script/CI

**Local dev**: frontend signs mock JWT client-side using `VITE_MOCK_JWT_SECRET`

## Google/Microsoft Login

Cognito User Pool already has Google and Microsoft identity providers configured
(shared with server-next). Frontend login page shows "Sign in with Google" and
"Sign in with Microsoft" buttons. The `identity_provider` parameter is passed to
`/oauth/authorize` to route to the correct provider.

## Frontend

### Pages

| Page | Path | Description |
|------|------|-------------|
| Login | `/` | Shown when not logged in; Google/Microsoft login buttons |
| OAuth Callback | `/oauth/callback` | Handles Cognito redirect, exchanges code, redirects to home |
| Home | `/` | Shown when logged in; tabs below |

### Home (logged in)

**Delegates**: table of delegates (name, permissions, created, expires, status, revoke action),
create dialog (name, permissions, TTL), token display with copy button.

> Note: Image generation UI deferred to next iteration (requires Casfa branch/token
> integration or new API).

### Tech

- React (existing dependency), inline styles, no router library
- `authStore`: User Token in localStorage, login/logout
- `apiFetch`: auto-attach Bearer header, logout on 401
- Dev mode: `import.meta.env.DEV` → sign mock JWT with `VITE_MOCK_JWT_SECRET`

## Backend File Structure

```
backend/
├── app.ts                  # Hono route registration
├── lambda.ts               # Lambda entry (unchanged)
├── db/
│   └── grant-store.ts      # DelegateGrantStore (DynamoDB CRUD)
├── controllers/
│   ├── oauth.ts            # /oauth/*, /.well-known/* routes
│   ├── delegates.ts        # /api/delegates/* routes
│   └── mcp.ts              # /mcp route (auth-protected MCP handler)
├── mcp/
│   └── server.ts           # MCP server & flux_image tool
├── middleware/
│   └── auth.ts             # Auth middleware
├── types/
│   └── auth.ts             # Auth type definitions
└── utils/
    ├── jwt.ts              # JWT verification (Cognito JWKS / mock HS256)
    ├── token.ts            # Delegate token generation & hash
    ├── cognito.ts          # Cognito token exchange
    ├── bfl.ts              # BFL API client (existing)
    └── casfa-branch.ts     # Casfa branch client (existing)
```

## cell.yaml Changes

Add grants table only. Backend entry unchanged (`routes: ["*"]`, single Lambda).

```yaml
tables:
  grants:
    keys:
      pk: S
      sk: S
    gsi:
      user-hash-index:
        keys:
          gsi1pk: S
          gsi1sk: S
        projection: ALL
      user-refresh-index:
        keys:
          gsi2pk: S
          gsi2sk: S
        projection: ALL
```

## CloudFront Routing

| Pattern | Target | Description |
|---------|--------|-------------|
| `/oauth/*` | Lambda (API Gateway) | OAuth endpoints |
| `/.well-known/*` | Lambda (API Gateway) | OAuth discovery |
| `/api/*` | Lambda (API Gateway) | Delegate management |
| `/mcp` | Lambda (API Gateway) | MCP endpoint |
| `/*` | S3 (Frontend) | Static assets, SPA fallback |

All paths handled by the same Lambda function.

## Local Dev (cell dev)

Vite proxy forwards to backend:
- `/api/*` (existing)
- `/oauth/*` (existing)
- `/mcp` (new)
- `/.well-known/*` (new)

## Environment Variables (new)

| Variable | Purpose |
|----------|---------|
| `DYNAMODB_TABLE_GRANTS` | Grants table name (auto-generated by cell-cli) |
| `MOCK_JWT_SECRET` | Mock JWT signing key (dev only) |
| `VITE_MOCK_JWT_SECRET` | Same value, exposed to frontend via Vite |
