# ID Format Unification Plan

**Date**: 2026-02-10
**Type**: Breaking Change (service not yet live, no data migration needed)

## Goal

Unify all ID formats to `prefix_[CrockfordBase32]{26}` (128-bit).

## New ID Formats

| ID Type       | Prefix | Format              | Example                              |
|---------------|--------|---------------------|--------------------------------------|
| User ID       | `usr_`  | `usr_[CB32]{26}`    | `usr_A6JCHNMFWRT90AXMYWHJ8HKS90`    |
| Realm ID      | `usr_`  | same as User ID     | `usr_A6JCHNMFWRT90AXMYWHJ8HKS90`    |
| Delegate ID   | `dlt_`  | `dlt_[CB32]{26}` (ULID-based) | `dlt_01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Token ID      | `tkn_`  | `tkn_[CB32]{26}`    | `tkn_5R8F1Y3GHKM9QXW2TV4BCEJN70`    |
| Depot ID      | `dpt_`  | `dpt_[CB32]{26}`    | `dpt_7QWER2T8Y3M5K9BXFNHJC6D0PV`    |
| Node ID       | `nod_`  | `nod_[CB32]{26}`    | `nod_A6JCHNMFWRT90AXMYWHJ8HKS90`    |
| Request ID    | `req_`  | `req_[CB32]{26}`    | `req_9X2M5K8BFNHJC6D0PV3QWER2T7Y`   |

## Removed Concepts

- **Ticket**: Completely removed (controller, DB, routes, protocol, CAS URI, CLI, MCP)
- **Family ID**: Replaced by Delegate ID (token rotation family = delegate)
- **CAS URI `ticket:` root type**: Removed

## CAS URI Format Changes

| Old                           | New                          |
|-------------------------------|------------------------------|
| `node:HASH/path`             | `nod_HASH/path`              |
| `depot:ID/path`              | `dpt_ID/path`                |
| `ticket:ID/path`             | *(removed)*                  |

Root types: `["node", "depot", "ticket"]` → `["nod", "dpt"]`

## Implementation Steps

### Step 1: Protocol Foundation (`packages/protocol/src/common.ts`)

- [x] Change `NODE_KEY_PREFIX` from `"node:"` to `"nod_"`
- [x] Update `hashToNodeKey`, `nodeKeyToHash`, `hexToNodeKey`, `nodeKeyToHex` (prefix slice length 5→4)
- [x] Update `EMPTY_DICT_NODE_KEY` (auto-computed from hex)
- [x] Fix `DELEGATE_TOKEN_ID_REGEX` → `/^tkn_[0-9A-HJKMNP-TV-Z]{26}$/`
- [x] Add `DELEGATE_ID_REGEX` = `/^dlt_[0-9A-HJKMNP-TV-Z]{26}$/`
- [x] Update `DEPOT_ID_REGEX` → `/^dpt_[0-9A-HJKMNP-TV-Z]{26}$/`
- [x] Update `REQUEST_ID_REGEX` → `/^req_[0-9A-HJKMNP-TV-Z]{26}$/`
- [x] Update `ISSUER_ID_REGEX` (replace `dlt1_` branch with `tkn_`)
- [x] Remove `TICKET_ID_REGEX`, `TicketIdSchema`, `TicketStatusSchema`
- [x] Remove deprecated `CLIENT_ID_REGEX`, `TOKEN_ID_REGEX`, etc.
- [x] Add `DelegateIdSchema`, update `DepotIdSchema`
- [x] Update `packages/protocol/src/index.ts` exports (remove ticket, add delegate ID)
- [x] Remove `packages/protocol/src/ticket.ts`
- [x] Update `packages/protocol/src/token.ts` comments (dlt1_ → tkn_)

### Step 2: User ID & Realm

- [x] `apps/server/backend/src/util/encoding.ts`: `"user:"` → `"usr_"` in `uuidToUserId`, `userIdToUuid`, `normalizeUserId`
- [x] `apps/server/backend/src/auth/jwt-verifier.ts`: `startsWith("user:")` → `"usr_"` in mock verifier
- [x] `apps/server/backend/src/middleware/jwt-auth.ts`: `realm: \`usr_${userId}\`` → `realm: userId` (userId already is `usr_XXX`)
- [x] `apps/server/backend/src/controllers/root-token.ts`: `expectedRealm = \`usr_${auth.userId}\`` → `expectedRealm = auth.userId`
- [x] `apps/server/frontend/src/lib/client.ts`: update realm construction

### Step 3: Delegate ID (UUID → `dlt_` CB32), Token ID (`dlt1_` → `tkn_`), Family Removal

- [x] `apps/server/backend/src/util/token-id.ts`: add `generateDelegateId()` using ULID→CB32
- [x] `apps/server/backend/src/controllers/delegates.ts`: `crypto.randomUUID()` → `generateDelegateId()`; remove `familyId = crypto.randomUUID()`
- [x] `apps/server/backend/src/controllers/root-token.ts`: same
- [x] `apps/server/backend/src/util/delegate-token-utils.ts`: rewrite `delegateIdToIssuer()` for `dlt_` CB32 format
- [x] `packages/delegate-token/src/constants.ts`: `TOKEN_ID_PREFIX = "tkn_"`
- [x] `apps/server/backend/src/db/token-records.ts`: `familyId` → `delegateId` (rename field, GSI key, `invalidateFamily` → `invalidateByDelegate`)
- [x] `apps/server/backend/src/controllers/refresh.ts`: `tokenRecord.familyId` → `tokenRecord.delegateId`

### Step 4: Depot ID, Request ID, Node Key

- [x] `apps/server/backend/src/util/token-id.ts`: `generateDepotId()` → CB32 format
- [x] `apps/server/backend/src/controllers/depots.ts`: remove `formatDepotId`/`formatRoot` wrappers (IDs are now canonical)
- [x] `apps/server/backend/src/db/depots.ts`: remove `depot:` prefix stripping
- [x] Depot initial root: use `hexToNodeKey(EMPTY_DICT_KEY)` → `nod_XXX` format
- [x] `apps/server/backend/src/util/token-request.ts`: `generateRequestId()` → CB32
- [x] `apps/server/backend/src/services/fs/tree-ops.ts`: `"node:"` → `"nod_"`, `"depot:"` → `"dpt_"`, remove `"ticket:"` branch

### Step 5: CAS URI Package

- [x] `packages/cas-uri/src/constants.ts`: `ROOT_TYPES = ["nod", "dpt"]`
- [x] `packages/cas-uri/src/types.ts`: `CasUriRootType = "nod" | "dpt"`; `CasUriRoot` remove ticket
- [x] `packages/cas-uri/src/parse.ts`: update root parsing for `nod_`/`dpt_` prefix style
- [x] `packages/cas-uri/src/format.ts`: update formatting; remove `ticketUri`
- [x] `packages/cas-uri/src/resolve.ts`: remove ticket from `uriEquals`
- [x] `packages/cas-uri/src/index.ts`: remove `ticketUri` export
- [x] `apps/server/backend/src/middleware/access-token.ts`: token ID prefix `dlt1_` → `tkn_`

### Step 6: Ticket Removal & Test Updates

- [x] Delete: `apps/server/backend/src/db/tickets.ts`
- [x] Delete: `apps/server/backend/src/controllers/tickets.ts`
- [x] Delete: `apps/server/backend/e2e/tickets.test.ts`
- [x] Modify: `apps/server/backend/src/bootstrap.ts` — remove ticketsDb
- [x] Modify: `apps/server/backend/src/app.ts` — remove ticket controller/wiring
- [x] Modify: `apps/server/backend/src/router.ts` — remove ticket routes and schemas
- [x] Modify: `apps/server/backend/src/db/index.ts` — remove ticket exports
- [x] Modify: `apps/server/backend/src/controllers/index.ts` — remove ticket exports
- [x] Modify: `apps/server/backend/src/mcp/handler.ts` — remove ticket tools
- [x] CLI: remove ticket commands if they exist
- [x] Update ALL test files with new ID formats

## Binary Token Compatibility

This is a **breaking change**. The 32-byte issuer field in delegate tokens now encodes
`dlt_` CB32 delegate IDs (decode CB32 → 16 bytes → left-pad to 32) instead of UUID.
Old tokens are incompatible.
