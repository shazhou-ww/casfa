# OAuth Refresh Token + User-Editable Client Name — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) MCP OAuth–issued tokens support refresh (issue refresh_token, token endpoint accepts grant_type=refresh_token); (2) On authorize page, user can edit the client name (caller’s client_id is reference only; stored grant uses user’s name).

**Architecture:** Refresh uses same delegate grant row: we add refresh_token and refreshTokenHash at issue time; token endpoint handles refresh by looking up grant via refreshTokenHash (new store method + DynamoDB GSI2). Client name is optional on authorize, stored in auth code and used as grant’s clientId (display name). No schema change to grant type beyond already-existing refreshTokenHash.

**Tech Stack:** Hono, DynamoDB (DelegateGrantsTable + new GSI), React/MUI (authorize page), OAuth 2.0 token endpoint.

---

## Part A: Refresh token support

### Task A1: DelegateGrantStore — add getByRefreshTokenHash

**Files:**
- Modify: `apps/server-next/backend/db/delegate-grants.ts`
- Modify: `apps/server-next/backend/db/dynamo-delegate-grant-store.ts`
- Modify: `apps/server-next/backend/db/memory` — N/A (logic lives in delegate-grants.ts createMemoryDelegateGrantStore)
- Test: `apps/server-next/backend/__tests__/middleware/auth.test.ts` (optional: add test that uses getByRefreshTokenHash if you add a refresh test later)

**Step 1: Extend interface and memory store**

In `delegate-grants.ts`:
- Add to `DelegateGrantStore` type: `getByRefreshTokenHash(realmId: string, refreshTokenHash: string): Promise<DelegateGrant | null>`.
- In `createMemoryDelegateGrantStore`, add a `Map` keyed by `realmId:refreshTokenHash` for refresh tokens. In `insert`, if `grant.refreshTokenHash` is set, add to this map. In `remove`, remove from map. In `updateTokens`, when updating refreshTokenHash, remove old key and add new key. Implement `getByRefreshTokenHash` to read from this map.

**Step 2: Implement DynamoDB getByRefreshTokenHash**

In `dynamo-delegate-grant-store.ts`:
- Add GSI2 constants: `GSI2_NAME = "realm-refresh-index"`, `GSI2PK_PREFIX = "REALM#"`, `GSI2SK_PREFIX = "REFRESH#"`.
- In `grantToItem`, when `grant.refreshTokenHash` is not null, set `gsi2pk: GSI2PK_PREFIX + realmId`, `gsi2sk: GSI2SK_PREFIX + grant.refreshTokenHash`.
- Implement `getByRefreshTokenHash(realmId, refreshTokenHash)` using Query on GSI2 with `gsi2pk = REALM#realmId` and `gsi2sk = REFRESH#refreshTokenHash`, limit 1, return itemToGrant(first item) or null.
- Do **not** add GSI2 to serverless.yml in this task (next task).

**Step 3: Add GSI2 to DynamoDB table**

In `serverless.yml`:
- Under `DelegateGrantsTable` → `AttributeDefinitions`, add `AttributeName: gsi2pk, AttributeType: S` and `AttributeName: gsi2sk, AttributeType: S`.
- Under `GlobalSecondaryIndexes`, add a second index:
  - `IndexName: realm-refresh-index`
  - KeySchema: `gsi2pk` HASH, `gsi2sk` RANGE
  - Projection: ALL

**Step 4: Run tests**

Run: `cd apps/server-next && bun test backend/__tests__`  
Expected: All pass (no tests yet for getByRefreshTokenHash; existing tests still pass).

**Step 5: Commit**

```bash
git add apps/server-next/backend/db/delegate-grants.ts apps/server-next/backend/db/dynamo-delegate-grant-store.ts apps/server-next/serverless.yml
git commit -m "feat(oauth): add getByRefreshTokenHash to DelegateGrantStore and GSI2 for refresh"
```

---

### Task A2: MCP OAuth — issue refresh_token and store hash

**Files:**
- Modify: `apps/server-next/backend/services/mcp-oauth.ts`
- Modify: `apps/server-next/backend/app.ts` (token response + cache shape)

**Step 1: Generate refresh_token in createMcpDelegateToken**

In `mcp-oauth.ts`:
- Generate a secure random string for refresh_token (e.g. 32 bytes hex, same style as randomCode).
- Compute refreshTokenHash = sha256Hex(refreshToken).
- In `delegateGrantStore.insert`, pass `refreshTokenHash` (no longer null).
- For memory store: ensure insert adds the grant to the refresh map (already done in A1).
- Return type: `Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn?: number }>`. Use same expiresIn as today (e.g. 30 days in seconds); refreshExpiresIn can be same or longer (e.g. 60 days).

**Step 2: Update token endpoint response and cache**

In `app.ts`:
- After `createMcpDelegateToken`, expect `refreshToken` and optionally `refreshExpiresIn`. Return in response: `refresh_token`, `expires_in`, and optionally `refresh_expires_in` if you add it.
- Update `cacheTokenForUsedCode` / `getCachedTokenForUsedCode` to include `refreshToken` (and optionally refreshExpiresIn) so duplicate code exchange also returns refresh_token.

**Step 3: Run backend tests**

Run: `cd apps/server-next && bun test backend/__tests__`  
Expected: Pass.

**Step 4: Commit**

```bash
git add apps/server-next/backend/services/mcp-oauth.ts apps/server-next/backend/app.ts
git commit -m "feat(oauth): issue refresh_token in MCP token response and cache"
```

---

### Task A3: Token endpoint — handle grant_type=refresh_token

**Files:**
- Modify: `apps/server-next/backend/app.ts`
- Modify: `apps/server-next/frontend/vite.config.ts` (discovery already has grant_types; ensure refresh_token is listed — check getMcpOAuthDiscovery)

**Step 1: Parse refresh_token request**

In `app.ts` POST `/api/oauth/mcp/token`:
- If `grant_type === "refresh_token"`, require `refresh_token` and `client_id` (no code, no code_verifier). Validate client_id matches the grant’s clientId (see below).
- Look up grant: `getByRefreshTokenHash(realmId, sha256(refresh_token))`. We don’t have realmId from the request — we need to either (a) encode realmId in the refresh token (e.g. payload), or (b) use a global lookup. Option (a): store in refresh token a payload like `{ sub: realmId, client_id: clientId }` and sign or HMAC it so we can decode and get realmId, then lookup by hash. Simpler: store opaque refresh token, and in DynamoDB we only have GSI2 (realmId, refreshTokenHash). So we must have realmId to query. So we need to encode realmId (and optionally client_id) into the refresh token so we can decode without DB (e.g. base64json.realmId.client_id.random). Then decode to get realmId, then getByRefreshTokenHash(realmId, sha256(refresh_token)). So refresh token format: either a JWT-like payload with sub=realmId, client_id=clientId, or a short string like base64url(realmId) + "." + base64url(clientId) + "." + random. Decode to get realmId, then lookup by hash.
- Implement: create refresh token as opaque string that includes realmId (and clientId) in a decodeable prefix, e.g. `base64url(JSON.stringify({ sub: realmId, client_id })) + "." + randomPart`. When handling refresh, split on first ".", decode first part to get realmId (and client_id), then hash the full token and call getByRefreshTokenHash(realmId, hash). Validate request client_id === decoded client_id.

**Step 2: Rotate tokens and return new tokens**

- After finding grant by refresh token hash, generate **new** access_token and refresh_token (same format as in createMcpDelegateToken: random/hash and optional payload for refresh to encode realmId). Call `delegateGrantStore.updateTokens(grant.delegateId, { accessTokenHash: sha256(newAccessToken), refreshTokenHash: sha256(newRefreshToken) })` so the same grant now has new tokens (old refresh is invalidated). Return the new access_token, refresh_token, expires_in. Do **not** call createMcpDelegateToken (that would create a new grant); either add a helper that only generates token strings + hashes, or inline the generation and then updateTokens.

**Step 3: Discovery**

In `vite.config.ts` getMcpOAuthDiscovery and any backend discovery, set `grant_types_supported: ["authorization_code", "refresh_token"]`.

**Step 4: Run tests**

Run: `cd apps/server-next && bun test backend/__tests__`  
Expected: Pass.

**Step 5: Commit**

```bash
git add apps/server-next/backend/app.ts apps/server-next/backend/services/mcp-oauth.ts apps/server-next/frontend/vite.config.ts
git commit -m "feat(oauth): token endpoint supports grant_type=refresh_token and rotation"
```

---

## Part B: User-editable client name on authorize

### Task B1: Backend — accept and store client_name in auth code

**Files:**
- Modify: `apps/server-next/backend/services/mcp-oauth.ts`
- Modify: `apps/server-next/backend/app.ts`

**Step 1: McpAuthCode type and createMcpAuthCode**

In `mcp-oauth.ts`:
- Add optional `clientName?: string` to `McpAuthCode`.
- `createMcpAuthCode` accepts optional `clientName` and stores it.

**Step 2: createMcpDelegateToken uses clientName for grant**

- Change signature to accept the full consumed entry (or at least `clientId` and optional `clientName`). When inserting the grant, set `clientId` to `entry.clientName ?? entry.clientId` so the display name in the delegates list is the user’s choice.

**Step 3: POST /api/oauth/mcp/authorize**

In `app.ts`:
- Parse body for optional `client_name` (string). Pass it to `createMcpAuthCode({ ..., clientName: client_name?.trim() || undefined })`.

**Step 4: Token exchange**

- When consuming the code, `entry` now has `clientName`. Pass to `createMcpDelegateToken(entry.realmId, entry.clientName ?? entry.clientId, ...)` (or pass entry and let createMcpDelegateToken use entry.clientName ?? entry.clientId for the grant’s clientId). Ensure token exchange still validates request `client_id` against `entry.clientId` (OAuth client_id), not the display name.

**Step 5: Run tests**

Run: `cd apps/server-next && bun test backend/__tests__`  
Expected: Pass.

**Step 6: Commit**

```bash
git add apps/server-next/backend/services/mcp-oauth.ts apps/server-next/backend/app.ts
git commit -m "feat(oauth): accept client_name on authorize and use as grant display name"
```

---

### Task B2: Frontend — client name input on authorize page

**Files:**
- Modify: `apps/server-next/frontend/src/pages/oauth-authorize-page.tsx`

**Step 1: State and default**

- Add state: `const [clientName, setClientName] = useState(client_id)` (default to `client_id` from query). When searchParams change (e.g. client_id), you can sync default once or keep user’s edit.

**Step 2: UI**

- Add a text field (e.g. MUI TextField) labeled “Client name” or “显示名称”, value=clientName, onChange setClientName, placeholder or helperText like “Caller suggested: {client_id}. You can change this.”

**Step 3: Submit**

- In handleAllow, send `client_name: clientName.trim() || client_id` in the JSON body to POST `/api/oauth/mcp/authorize`.

**Step 4: Manual test**

- Open /oauth/authorize?client_id=test&redirect_uri=...&state=...&code_challenge=...&code_challenge_method=S256, edit client name, Allow; then in delegates list verify the new delegate shows the edited name.

**Step 5: Commit**

```bash
git add apps/server-next/frontend/src/pages/oauth-authorize-page.tsx
git commit -m "feat(oauth): allow user to edit client name on authorize page"
```

---

## Summary

| Part | Description |
|------|-------------|
| A1   | Store: getByRefreshTokenHash + memory map + DynamoDB GSI2 (realm-refresh-index) |
| A2   | Issue refresh_token in createMcpDelegateToken and in token response/cache |
| A3   | Token endpoint: grant_type=refresh_token, decode realmId from token, lookup, rotate, return new tokens; discovery grant_types_supported |
| B1   | Backend: client_name in auth code and grant’s clientId = clientName ?? clientId |
| B2   | Frontend: client name input on authorize page and send client_name in POST |

**Verification:**  
- OAuth flow: authorize with optional client name → token exchange returns access_token + refresh_token.  
- Refresh: POST /api/oauth/mcp/token with grant_type=refresh_token, refresh_token, client_id → 200 with new access_token and refresh_token.  
- Delegates list shows the user-edited client name for the new grant.

Plan complete and saved to `docs/plans/2026-03-02-oauth-refresh-and-client-name.md`. Two execution options:

1. **Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints.

Which approach?
