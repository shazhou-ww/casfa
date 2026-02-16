# Redis Caching Layer

## Overview

We use Redis to cache **immutable data** and **high-frequency mutable data** to reduce DynamoDB / S3 read pressure and lower P99 latency. Three tiers of data are cached:

1. **Immutable (no TTL)** — Ownership existence checks, CAS node metadata. Content-addressed, never changes. No invalidation needed.
2. **Semi-stable (short TTL + write invalidation)** — Delegate records (every auth request), Depot records (every depot operation). Rarely change; invalidated on write.
3. **Optimistic (very short TTL)** — Usage / quota checks (every upload). High write frequency but tolerates stale reads.

The system falls through to the backing store when Redis is unavailable — Redis is a pure optimization layer.

## Data Classification & Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                     IMMUTABLE (no TTL)                          │
│  一旦写入，内容永远不变，可无限期缓存                              │
│                                                                 │
│  • Ownership 记录 (own:* → DynamoDB bypass)                     │
│  • CAS Node metadata (node:meta:* → S3 bypass)                  │
│  • ScopeSetNode 内容 (content-addressed children)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  SEMI-STABLE (TTL + write invalidation)          │
│  变更不频繁，短 TTL 缓存 + 写操作时主动 DEL                       │
│                                                                 │
│  • Delegate 记录 (dlg:* — every auth request, TTL = 30s)        │
│  • Depot 记录 (dpt:* — every depot op, TTL = 10s)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  OPTIMISTIC (very short TTL)                     │
│  每次上传都更新，容忍秒级不一致                                    │
│                                                                 │
│  • Usage / Quota (usg:* — every upload, TTL = 5s)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  NOT CACHED                                     │
│  强一致性要求或缓存价值低                                         │
│                                                                 │
│  • RefCount (conditional update，缓存会破坏一致性)               │
│  • TokenRecords (一次性使用标记，极少读取)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Cache Strategy Matrix

| Priority | Data | Redis Key | TTL | Strategy | Reason |
|----------|------|-----------|-----|----------|--------|
| **P0** | `hasOwnership(hash, dlgId)` | `own:{hash}:{dlgId}` | ∞ | Cache-Aside + write pre-warm | **最热路径**: upload N×M 次, read 每次. Immutable |
| **P0** | `hasAnyOwnership(hash)` | `own:any:{hash}` | ∞ | Cache-Aside + write pre-warm | 每次 `chunks.get`. Immutable |
| **P0** | Node metadata | `node:meta:{key}` | ∞ | Cache-Aside + write pre-warm | S3 GetObject + decode 开销大. Immutable |
| **P1** | `delegatesDb.get(id)` | `dlg:{id}` | 30s | Cache-Aside + write DEL | **每个认证请求**. Token rotation/revoke 时失效 |
| **P2** | `depotsDb.get(realm, id)` | `dpt:{realm}:{id}` | 10s | Cache-Aside + write DEL | 每次 depot 操作. Commit 时失效 |
| **P2** | ScopeSetNode | `ssn:{id}` | 1h | Cache-Aside | Content-addressed, 只有 refCount 变 |
| **P3** | `usageDb.getUsage(realm)` | `usg:{realm}` | 5s | Cache-Aside (乐观) | 每次上传 quota check, 容忍短暂过期 |
| — | RefCount | — | — | 不缓存 | Conditional update 需强一致性 |
| — | TokenRecords | — | — | 不缓存 | 一次性使用 |

## Architecture

```
                     ┌─────────────────────────────────┐
                     │         Redis Cache              │
                     │  own:*     → DynamoDB bypass     │
                     │  node:*    → S3 bypass           │
                     │  dlg:*     → DynamoDB bypass     │
                     │  dpt:*     → DynamoDB bypass     │
                     │  usg:*     → DynamoDB bypass     │
                     └─────────────────────────────────┘
                              ▲           │
                         miss │           │ hit
                              │           ▼
Request → API Handler → cache lookup → return cached
                              │
                         miss ▼
                    backing store query
                    (DynamoDB or S3)
                              │
                   result? → write to Redis (with TTL if mutable)
                              │
                        return result

                    ┌──── Write Path ────┐
                    │ Immutable: SET     │
                    │ Mutable:   DEL     │
                    └────────────────────┘
```

- **Immutable data**: cached permanently (no TTL). Only positive results cached.
- **Semi-stable data**: cached with short TTL. Write operations issue `DEL` to invalidate.
- **Optimistic data**: cached with very short TTL. No explicit invalidation — TTL handles staleness.
- **Negative results** (record does not exist) are **never cached** — they may be created later.
- **Redis failures** are silently swallowed — all operations fall through to the backing store.

## Cached Methods

### 1. Ownership Existence (DynamoDB → Redis)

Cached in `ownership-v2.ts`.

| Method | Cache Key | Cached Value | Cache Fill | Notes |
|---|---|---|---|---|
| `hasOwnership(nodeHash, delegateId)` | `own:{nodeHash}:{delegateId}` | `"1"` | Read-path cache-aside + write-path pre-warm | Only `true` is cached |
| `hasAnyOwnership(nodeHash)` | `own:any:{nodeHash}` | `"1"` | Read-path cache-aside + write-path pre-warm | Only `true` is cached |
| `getOwnership(nodeHash, delegateId)` | — | — | — | **Not cached** — `addOwnership` uses unconditional `BatchWriteItem`; concurrent uploads can overwrite metadata (`uploadedBy`, `size`, `createdAt`), making cached JSON stale |
| `listOwners(nodeHash)` | — | — | — | **Not cached** (list grows with new uploads) |

### 2. CAS Node Metadata (S3 → Redis)

Cached in a new `node-cache.ts` module. CAS nodes are content-addressed: the storage key **is** the hash of the content. The same key always yields the same bytes, making decoded metadata **absolutely immutable** — stronger than ownership.

| Cache Key | Cached Value | Cache Fill | Notes |
|---|---|---|---|
| `node:meta:{storageKey}` | JSON string (see below) | Read-path cache-aside + write-path pre-warm on `chunks.put` | No TTL needed |

**Cached JSON shape by node kind:**

```typescript
// dict node
{ kind: "dict", size: number, children: string[], childNames: string[] }

// file node
{ kind: "file", size: number, contentType: string, successor?: string }

// successor node
{ kind: "successor", size: number, successor?: string }
```

**Size guard:** If the serialized JSON exceeds **8 KB**, it is **not cached** (large dict nodes with hundreds of children). This bounds Redis memory usage per key.

**Hot paths that benefit:**

| Call site | What it avoids | Frequency |
|---|---|---|
| `scope-proof.ts` — tree traversal | S3 GetObject + `decodeNode` per tree depth level | N per proof validation |
| `app.ts` — `resolveNode` | S3 GetObject + `decodeNode` for scope resolution | Per delegate creation |
| `chunks.ts` — `getMetadata` endpoint | S3 GetObject + `decodeNode` to return JSON | Per metadata request |
| `chunks.ts` — `put` child size validation | S3 GetObject + `decodeNode` per child of dict node | Per dict upload |

### Write-Path Pre-Warming

**`addOwnership` (ownership keys):** After successful DynamoDB `BatchWriteItem`:
- `own:{nodeHash}:{delegateId}` → `"1"` for each chain member
- `own:any:{nodeHash}` → `"1"`

> **Only boolean existence keys are cached.** `getOwnership` returns structured metadata (`uploadedBy`, `size`, `createdAt`) that can be overwritten by concurrent uploads via `BatchWriteItem` (unconditional overwrite). Caching it would violate the immutable-only principle. Boolean keys (`hasOwnership`, `hasAnyOwnership`) are unaffected — any write confirms existence, regardless of metadata.

**`chunks.put` (node metadata):** After successful storage write + validation, the fully decoded node metadata is written to Redis:

```typescript
// In chunks.put, after storage.put(storageKey, bytes) succeeds:
const decoded = decodeNode(bytes);
const meta = buildNodeMeta(decoded); // extract kind, size, children, etc.
const json = JSON.stringify(meta);
if (json.length <= 8192) { // 8 KB size guard
  await cacheSet(redis, `node:meta:${storageKey}`, json);
}
```

This is safe because the bytes were just validated and written — the cached metadata exactly matches what S3 now stores.

### Batch Lookup Optimization (`MGET`)

The `check-nodes` endpoint iterates `hasOwnership` for each delegate in the chain (up to 16 levels). To avoid N serial Redis round-trips, we use `MGET` to batch-query all chain members in a single call:

```typescript
// cache.ts
async function cacheMGet(redis: Redis | null, keys: string[]): Promise<(string | null)[]> {
  if (!redis || keys.length === 0) return keys.map(() => null);
  try {
    return await redis.mget(...keys);
  } catch {
    return keys.map(() => null);
  }
}

// ownership-v2.ts — hasOwnershipBatch
const hasOwnershipBatch = async (nodeHash: string, delegateIds: string[]): Promise<string | null> => {
  const keys = delegateIds.map((id) => `own:${nodeHash}:${id}`);
  const results = await cacheMGet(redisClient, keys);
  // Return first hit
  for (let i = 0; i < results.length; i++) {
    if (results[i] !== null) return delegateIds[i];
  }
  // All missed — fall through to DynamoDB, one by one (with cache-aside fill)
  for (const id of delegateIds) {
    if (await hasOwnership(nodeHash, id)) return id;
  }
  return null;
};
```

This reduces the worst-case from **16 serial Redis round-trips to 1** for cached nodes.

### 3. Delegate Records (DynamoDB → Redis, TTL = 30s)

Cached in a new `cached-delegates.ts` wrapper. Delegates are the **single most frequently read entity** — `delegatesDb.get()` is called on **every authenticated request** by `accessTokenMiddleware`.

| Method | Cache Key | Cached Value | TTL | Cache Fill | Invalidation |
|---|---|---|---|---|---|
| `get(delegateId)` | `dlg:{delegateId}` | Full delegate JSON | 30s | Read-path cache-aside | `revoke()`, `rotateTokens()` → `DEL` |
| `revoke(...)` | — | — | — | — | `DEL dlg:{delegateId}` after DynamoDB update |
| `rotateTokens(...)` | — | — | — | — | `DEL dlg:{delegateId}` after DynamoDB update |
| `create(...)` | — | — | — | — | No cache action (not yet queried) |
| `listChildren(...)` | — | — | — | — | **Not cached** (list, infrequent) |
| `getRootByRealm(...)` | — | — | — | — | **Not cached** (GSI query, infrequent) |

**Why TTL = 30s:**
- Token rotation happens at most once per refresh cycle (≥ minutes apart)
- Revocation is rare and time-sensitive, so we also issue explicit `DEL`
- 30s balances hit rate vs staleness — a revoked delegate is honored within 30s worst case
- Each Lambda invocation handles ~1 request, so the cache primarily benefits **cross-invocation warm starts** and **burst traffic within the TTL window**

**Implementation sketch:**

```typescript
// cached-delegates.ts
export const withDelegateCache = (
  db: DelegatesDb,
  cache: CacheProvider,
  prefix: string,
  ttl = 30
): DelegatesDb => ({
  ...db,

  get: async (delegateId) => {
    const key = `${prefix}dlg:${delegateId}`;
    const cached = await cacheGet(cache, key);
    if (cached) return JSON.parse(cached);

    const result = await db.get(delegateId);
    if (result) {
      cacheSet(cache, key, JSON.stringify(result), ttl).catch(() => {});
    }
    return result;
  },

  revoke: async (...args) => {
    await db.revoke(...args);
    const [delegateId] = args;
    cacheDel(cache, `${prefix}dlg:${delegateId}`).catch(() => {});
  },

  rotateTokens: async (...args) => {
    await db.rotateTokens(...args);
    const [delegateId] = args;
    cacheDel(cache, `${prefix}dlg:${delegateId}`).catch(() => {});
  },
});
```

### 4. Depot Records (DynamoDB → Redis, TTL = 10s)

Cached in a new `cached-depots.ts` wrapper. `depotsDb.get()` is called on every depot read, commit, and filesystem operation.

| Method | Cache Key | Cached Value | TTL | Cache Fill | Invalidation |
|---|---|---|---|---|---|
| `get(realm, depotId)` | `dpt:{realm}:{depotId}` | Full depot JSON | 10s | Read-path cache-aside | `commit()`, `update()`, `delete()` → `DEL` |
| `getByName(realm, name)` | `dpt:n:{realm}:{name}` | Full depot JSON | 10s | Read-path cache-aside | `commit()`, `update()`, `delete()` → `DEL` both keys |
| `commit(...)` | — | — | — | — | `DEL dpt:{realm}:{depotId}` + `DEL dpt:n:{realm}:{name}` |
| `update(...)` | — | — | — | — | `DEL dpt:{realm}:{depotId}` + `DEL dpt:n:{realm}:{name}` |
| `delete(...)` | — | — | — | — | `DEL dpt:{realm}:{depotId}` + `DEL dpt:n:{realm}:{name}` |
| `list(...)` | — | — | — | — | **Not cached** (list query, paginated) |
| `create(...)` | — | — | — | — | No cache action |

**Why TTL = 10s:**
- Depot `root` changes on every `commit` — explicit `DEL` ensures immediate consistency
- 10s TTL is a safety net for edge cases (e.g., direct DynamoDB edits)
- Commits are relatively infrequent (user-initiated), so cache hit rate is still high between commits

### 5. Usage / Quota (DynamoDB → Redis, TTL = 5s)

Cached in a new `cached-usage.ts` wrapper. `usageDb.getUsage()` is called on every upload for quota check.

| Method | Cache Key | Cached Value | TTL | Cache Fill | Notes |
|---|---|---|---|---|---|
| `getUsage(realm)` | `usg:{realm}` | JSON `{ physicalBytes, logicalBytes, nodeCount, quotaLimit }` | 5s | Read-path cache-aside | **Optimistic** — stale reads tolerated |
| `checkQuota(realm)` | uses `getUsage` | — | — | — | Inherits caching from `getUsage` |
| `updateUsage(...)` | — | — | — | — | **No invalidation** — TTL handles it |
| `getUserQuota(realm)` | `usg:q:{realm}` | JSON | 5s | Read-path cache-aside | Less frequent, also optimistic |

**Why no explicit invalidation:**
- `updateUsage` is called on every upload — DEL'ing the cache on every write would negate caching
- 5s TTL means the quota check can be at most 5s stale
- Worst case: a few extra nodes uploaded before quota enforcement kicks in — acceptable
- DynamoDB `updateUsage` uses atomic `ADD`, so the authoritative count is always correct

## Local Development

### Prerequisites

Docker must be running. `bun run dev` automatically starts all Docker services (DynamoDB + Redis) via `docker compose`.

### Commands

```bash
bun run dev           # Default: Docker (DynamoDB + Redis) + fs storage + mock auth + frontend
bun run dev:aws       # Connect to real AWS services (Cognito + S3), no local Docker
bun run dev:minimal   # All in-memory (no Docker), no frontend — for quick tests
```

### Presets

| Preset | Command | DynamoDB | Redis | Storage | Auth |
|---|---|---|---|---|---|
| (default) | `bun run dev` | `persistent` (port 8700) | `redis://localhost:6379` | fs | mock |
| `local` | `--preset local` | `persistent` (port 8700) | `redis://localhost:6379` | fs | mock |
| `e2e` | `--preset e2e` | `memory` (port 8701) | `redis://localhost:6380` | memory | mock |
| `dev` | `--preset dev` | AWS | disabled | s3 | cognito |

The dev script auto-starts the corresponding Docker containers:
- Default/local: `dynamodb` + `redis`
- E2E: `dynamodb-test` + `redis-test`
- Dev (AWS): no Docker services

### Docker Compose Services

```yaml
# DynamoDB (persistent, port 8700) — daily development
dynamodb:

# DynamoDB (in-memory, port 8701) — E2E tests
dynamodb-test:

# Redis (persistent, port 6379) — daily development
redis:
  image: redis:7-alpine
  container_name: casfa-redis
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data

# Redis (ephemeral, port 6380) — E2E tests
redis-test:
  image: redis:7-alpine
  container_name: casfa-redis-test
  ports:
    - "6380:6379"
  command: redis-server --save ""
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_ENABLED` | `true` | Set to `false` to disable Redis entirely |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REDIS_KEY_PREFIX` | `cas:` | Key prefix (allows multi-env sharing) |
| `REDIS_CONNECT_TIMEOUT_MS` | `2000` | Connection timeout |
| `REDIS_COMMAND_TIMEOUT_MS` | `500` | Per-command timeout |
| `REDIS_LOG_LEVEL` | (none) | Set to `debug` to log cache hit/miss to stdout |

### Verifying Redis is Working

```bash
# bun run dev auto-starts Redis, but you can also manage manually:
docker compose up -d redis

# Connect with redis-cli
docker exec -it casfa-redis redis-cli

# Monitor cache activity in real-time
docker exec -it casfa-redis redis-cli MONITOR

# Check cached keys
docker exec -it casfa-redis redis-cli KEYS "cas:*"
```

## Production (AWS)

### Infrastructure

- **ElastiCache**: `cache.t4g.micro` single-node (~$12/month) for dev/staging; ElastiCache Serverless for prod (auto-scales). Controlled by `StageName` condition in SAM template. Cache loss is non-critical — data rebuilds on demand from DynamoDB.
- **Lambda (CasfaFunction)** joins the same VPC to reach ElastiCache.
- **Provisioned Concurrency** (`ProvisionedConcurrentExecutions: 1`) on the Lambda to mitigate VPC cold starts (~1s ENI attachment overhead on first invocation).
- **VPC Endpoints** to avoid NAT Gateway costs:
  - `com.amazonaws.{region}.dynamodb` — Gateway endpoint (free)
  - `com.amazonaws.{region}.s3` — Gateway endpoint (free)
  - `com.amazonaws.{region}.cognito-idp` — Interface endpoint

### Cost Estimates

| Resource | dev/staging | prod |
|---|---|---|
| ElastiCache | `cache.t4g.micro` ~$12/mo | Serverless ~$73/mo (minimum baseline) |
| VPC Endpoint - Interface (Cognito) | ~$7/AZ × 2 = ~$14 | ~$14 |
| VPC Endpoint - Gateway (DynamoDB, S3) | Free | Free |
| Provisioned Concurrency (1 unit) | ~$3–5 | ~$3–5 |
| NAT Gateway | **$0** (avoided) | **$0** (avoided) |

### Security Groups

```
┌──────────────────┐         ┌─────────────────────┐
│  Lambda SG       │────────▶│  ElastiCache SG      │
│  (outbound 6379) │         │  (inbound 6379 from  │
│                  │         │   Lambda SG)          │
└──────────────────┘         └─────────────────────┘
```

## ioredis Configuration (Lambda)

Lambda freeze/thaw cycles break TCP connections. Use these ioredis settings:

```typescript
import Redis from "ioredis";

const createRedisClient = (url: string): Redis | null => {
  try {
    return new Redis(url, {
      lazyConnect: true,          // Don't connect on import (Lambda cold start)
      maxRetriesPerRequest: 1,    // Fast fail — don't block request on Redis errors
      connectTimeout: 2000,       // 2s connect timeout (Lambda has ~10s budget)
      commandTimeout: 1000,       // 1s per command — fallback to DynamoDB if slow
      enableOfflineQueue: false,  // Reject commands when disconnected (fail fast)
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 200, 1000);
      },
    });
  } catch {
    return null;
  }
};
```

Key settings rationale:
- **`lazyConnect: true`** — Avoids blocking Lambda init phase. Connection is established on first command.
- **`maxRetriesPerRequest: 1`** — Each request retries at most once, then falls through to DynamoDB. Prevents request timeout from Redis retries.
- **`enableOfflineQueue: false`** — Commands issued while disconnected reject immediately instead of queueing. Queued commands would execute on reconnect with stale context.
- **`commandTimeout: 1000`** — If a single Redis command takes >1s, it's faster to just query DynamoDB directly.

## Code Structure

```
backend/src/db/
├── redis-client.ts       # Redis connection singleton, graceful degradation
├── cache.ts              # Cache utilities: cacheGet, cacheSet, cacheDel, cacheMGet
├── node-cache.ts         # Node metadata cache: getNodeMeta, setNodeMeta, buildNodeMeta
├── cached-delegates.ts   # withDelegateCache wrapper (TTL=30s + write DEL)
├── cached-depots.ts      # withDepotCache wrapper (TTL=10s + write DEL)
├── cached-usage.ts       # withUsageCache wrapper (TTL=5s, optimistic)
├── ownership-v2.ts       # Updated with Redis caching (immutable, no TTL)
├── client.ts             # DynamoDB client (unchanged)
└── ...

backend/src/
├── config.ts             # Extended with RedisConfig
├── bootstrap.ts          # Creates Redis client, injects cache wrappers into all DB modules
└── app.ts                # Updated: resolveNode uses node-cache
```

### Key Design Decisions

1. **Three-tier caching** — Immutable data (no TTL), semi-stable data (short TTL + write invalidation), optimistic data (very short TTL). Each tier has clear consistency guarantees.
2. **No negative caching** — Avoids the need to invalidate when new records/nodes are created. Trade-off: repeated misses hit DynamoDB/S3, acceptable for current load.
3. **Graceful degradation** — Every Redis call is wrapped in try-catch. If Redis is down, unavailable, or disabled, the system behaves identically to pre-cache behavior.
4. **Immutable = no TTL** — Ownership records and CAS nodes are content-addressed. Once cached, they are valid forever. Redis memory is bounded by the number of unique records/nodes queried. (See GC considerations below.)
5. **Semi-stable = TTL + DEL on write** — Delegate and Depot records change infrequently. Short TTL provides a safety net; explicit DEL on `revoke`, `rotateTokens`, `commit` ensures prompt invalidation.
6. **`getOwnership` excluded** — Metadata fields (`uploadedBy`, `size`, `createdAt`) can be overwritten by concurrent `BatchWriteItem` calls. Only boolean existence is truly immutable.
7. **Batch `MGET` for chain lookups** — `hasOwnershipBatch` sends one `MGET` for all chain members, reducing N serial round-trips to 1.
8. **Node metadata size guard (8 KB)** — Large dict nodes with hundreds of children are not cached, bounding per-key memory. The S3 read for these is amortized by their rarity.
9. **Quota is optimistic** — `usageDb.getUsage` is cached with 5s TTL. Concurrent uploads may briefly exceed quota by a few nodes, which is acceptable for our use case.

## Observability

### Metrics

`cache.ts` tracks hit/miss counters per method. Exposed as:

- **Structured log** (always): `{ event: "cache", method: "hasOwnership"|"getNodeMeta"|..., result: "hit"|"miss"|"error", latencyMs: number }`
- **Debug log** (`REDIS_LOG_LEVEL=debug`): Prints every cache key accessed (local dev only).
- **CloudWatch Custom Metric** (production): `CasfaCache/HitRate`, `CasfaCache/MissRate`, `CasfaCache/ErrorRate` — emitted via [EMF](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html) (Embedded Metric Format) in Lambda logs. No extra SDK/agent needed.

### Alarms (Production)

| Alarm | Threshold | Action |
|---|---|---|
| Cache error rate | > 10% over 5 min | SNS notification — investigate Redis connectivity |
| ElastiCache `BytesUsedForCache` | > 80% of max memory | SNS notification — may need larger instance |
| Ownership cache hit rate | < 20% over 1 hour | Informational — ownership caching may not be effective |
| Node meta cache hit rate | < 20% over 1 hour | Informational — node metadata caching may not be effective |

## Testing Strategy

| Test Suite | Redis | Purpose |
|---|---|---|
| Unit tests (`bun test`) | Mocked | Test cache-aside logic, `MGET` batching, error fallback |
| E2E (`--preset e2e`) | `redis-test` on port 6380 | Validate caching behavior with ephemeral Redis |
| E2E no-cache | `REDIS_ENABLED=false` | Validate system works without Redis (baseline correctness) |

The `e2e` preset uses the `redis-test` container (in-memory, no persistence) which starts clean each run. CI should run both with and without `REDIS_ENABLED` to ensure correctness on both paths.

## Expected Impact

### Upload Request (PUT node, 4 children, chain depth = 3)

| Operation | Without cache (DynamoDB) | With cache |
|---|---|---|
| `hasOwnership` (per child × chain) | 4 × 3 = **12** GetItem | ≤ 12 Redis GET (hit rate > 90%) |
| `checkQuota` / `getUsage` | 1 GetItem | 1 Redis GET (TTL 5s) |
| **DynamoDB reads saved** | **13** | **≈ 12** (only misses go to DDB) |

### Read Request (GET node)

| Operation | Without cache | With cache |
|---|---|---|
| `hasAnyOwnership` | 1 DynamoDB Query | 1 Redis GET |
| `storage.get` | 1 S3 GET | 1 S3 GET (large blobs stay in S3) |
| **DynamoDB reads saved** | — | **1** |

### Auth Middleware (every authenticated request)

| Operation | Without cache | With cache |
|---|---|---|
| `delegatesDb.get` | 1 DynamoDB GetItem | 1 Redis GET (TTL 30s, hit rate > 95%) |

### Depot Commit

| Operation | Without cache | With cache |
|---|---|---|
| `depotsDb.get` | 1 GetItem | 1 Redis GET (TTL 10s) |
| `hasOwnership` (per chain) | 3 GetItem | 3 Redis GET |
| **DynamoDB reads saved** | — | **4** |

## Future Considerations

### GC and Cache Invalidation

Currently ownership records are never deleted, so `hasOwnership = true` is permanently valid. When GC is implemented (deleting nodes whose refcount reaches 0), cached existence keys become stale.

**Strategy: GC pipeline cleans up Redis keys.** GC is a controlled, low-frequency background job that knows exactly which `(nodeHash, delegateId)` pairs it deletes. Add cache cleanup as a step in the GC pipeline:

```typescript
// In GC job, after deleting ownership records from DynamoDB:
await redis.del(`own:${nodeHash}:${delegateId}`);

// For own:any:{nodeHash}, only delete if ALL owners of this node are GC'd:
const remainingOwners = await ownershipDb.listOwners(nodeHash);
if (remainingOwners.length === 0) {
  await redis.del(`own:any:${nodeHash}`);
}
```

This is preferred over preemptive TTL because:
- GC has full context — it knows precisely which keys to invalidate
- No TTL means higher hit rate for the 99.9% of records that are never GC'd
- Adding a few `DEL` calls to the GC pipeline is trivial (~5 lines of code)
- If Redis `DEL` fails, the worst case is a stale `true` — the request will fail at the storage layer (blob already deleted by GC), which is a safe failure mode

### Other

- **Negative caching**: If DynamoDB read pressure from repeated misses becomes significant, we can add short-TTL (30s) negative caching. This would require invalidating negative keys in `addOwnership`.
- **Scope set-node caching**: `scope-set-nodes` children fields are also immutable candidates for caching if read pressure increases. (Currently P2 priority — can be added alongside delegate caching.)
- **ElastiCache Serverless migration**: Start with `cache.t4g.micro` for dev/staging, migrate to Serverless when traffic justifies the minimum baseline cost.
- **Redis memory monitoring**: CloudWatch alarms on `BytesUsedForCache` / `DatabaseMemoryUsagePercentage` to catch unbounded growth.
- **Delegate cache pub/sub invalidation**: For multi-instance deployments, consider Redis pub/sub to broadcast delegate revocations to all instances. Currently not needed (single Lambda function).

## Implementation Plan

### Phase 1: Infrastructure (1–2 days)

- [ ] `config.ts` — add `RedisConfig` + `loadRedisConfig()`
- [ ] `redis-client.ts` — Redis connection singleton with ioredis
- [ ] `cache.ts` — `cacheGet`, `cacheSet`, `cacheDel`, `cacheMGet` utilities
- [ ] `docker-compose.yml` — add `redis` + `redis-test` services
- [ ] `.env.example` — add Redis configuration variables
- [ ] Dev script presets — wire up Redis enable/disable per preset

### Phase 2: P0 — Ownership + Node Metadata Caching (1–2 days)

- [ ] `ownership-v2.ts` — integrate Redis caching for `hasOwnership`, `hasAnyOwnership`, `addOwnership` pre-warm
- [ ] `node-cache.ts` — implement node metadata cache with 8 KB size guard
- [ ] `chunks.ts` — wire up node metadata cache on GET/PUT
- [ ] E2E tests — validate cache hit/miss, upload/claim correctness

### Phase 3: P1 — Delegate Caching (1 day)

- [ ] `cached-delegates.ts` — `withDelegateCache` wrapper (TTL=30s, DEL on revoke/rotate)
- [ ] `bootstrap.ts` — inject cached wrapper into `delegatesDb`
- [ ] Test auth middleware latency with cache hit vs miss
- [ ] Test revocation propagation within TTL window

### Phase 4: P2 — Depot + ScopeSetNode Caching (1 day)

- [ ] `cached-depots.ts` — `withDepotCache` wrapper (TTL=10s, DEL on commit/update/delete)
- [ ] ScopeSetNode caching (TTL=1h, content-addressed)
- [ ] E2E — commit flow, depot list correctness

### Phase 5: P3 — Usage / Quota Caching (0.5 day)

- [ ] `cached-usage.ts` — `withUsageCache` wrapper (TTL=5s, no write invalidation)
- [ ] Verify quota enforcement under concurrent uploads

### Phase 6: Production Deployment (1–2 days)

- [ ] SAM template — ElastiCache Serverless resource + VPC config
- [ ] Security groups (Lambda ↔ ElastiCache)
- [ ] VPC Endpoints (DynamoDB, S3, Cognito)
- [ ] Gradual rollout: `REDIS_ENABLED=true` with monitoring
- [ ] CloudWatch dashboards + alarms (hit rate, error rate, memory)
