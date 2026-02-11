# Redis Caching Layer

## Overview

We use Redis to cache **immutable data only** to reduce DynamoDB and S3 read pressure. Two categories of data are cached:

1. **Ownership existence** — boolean checks (`hasOwnership`, `hasAnyOwnership`) that reduce DynamoDB reads
2. **CAS node metadata** — decoded node structure (`kind`, `size`, `children`, `contentType`) that eliminates S3 GetObject + decode overhead

Since all cached data is content-addressed and immutable, there is **no cache invalidation logic** — reads fill the cache on miss, and the system falls through to the backing store when Redis is unavailable.

## Architecture

```
                     ┌─────────────────────────────────┐
                     │         Redis Cache              │
                     │  own:*   → DynamoDB bypass       │
                     │  node:*  → S3 bypass             │
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
                   positive? → write to Redis
                              │
                        return result
```

- **Positive results** are cached permanently (no TTL).
- **Negative results** (record/node does not exist) are **never cached** — they may be created later.
- **Redis failures** are silently swallowed — all operations fall through to the backing store. Redis is a pure optimization layer; the system is fully functional without it.

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

## Local Development

### Prerequisites

Docker must be running.

### Presets

| Preset | Redis behavior | Notes |
|---|---|---|
| `local` | `redis://localhost:6379` via docker-compose | Auto-starts `redis` container alongside `dynamodb` |
| `e2e` | Disabled (`REDIS_ENABLED=false`) | Tests run without Redis |
| `e2e:redis` | `redis://localhost:6380` via docker-compose | E2E with Redis enabled (uses `redis-test` container) |
| `dev` / `aws` | From environment variable `REDIS_URL` | Connects to remote Redis |

### Docker Compose Services

```yaml
# redis for local development (persistent)
redis:
  image: redis:7-alpine
  container_name: casfa-redis
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
  restart: unless-stopped

# redis for e2e tests (no persistence, isolated port)
redis-test:
  image: redis:7-alpine
  container_name: casfa-redis-test
  ports:
    - "6380:6379"
  command: redis-server --save ""
  restart: "no"
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REDIS_ENABLED` | `true` | Set to `false` to disable Redis entirely |
| `REDIS_LOG_LEVEL` | (none) | Set to `debug` to log cache hit/miss to stdout |

### Verifying Redis is Working

```bash
# Start redis container
docker compose up -d redis

# Connect with redis-cli
docker exec -it casfa-redis redis-cli

# Monitor cache activity in real-time
docker exec -it casfa-redis redis-cli MONITOR

# Check cached keys
docker exec -it casfa-redis redis-cli KEYS "own:*"
docker exec -it casfa-redis redis-cli KEYS "node:meta:*"
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
├── redis-client.ts    # Redis connection singleton, graceful degradation
├── cache.ts           # Cache utilities: cacheGet, cacheSet, cacheMGet
├── node-cache.ts      # Node metadata cache: getNodeMeta, setNodeMeta, buildNodeMeta
├── ownership-v2.ts    # Updated with Redis caching
├── client.ts          # DynamoDB client (unchanged)
└── ...

backend/src/
├── config.ts          # Extended with RedisConfig
├── bootstrap.ts       # Creates Redis client, injects into ownershipV2Db & controllers
└── app.ts             # Updated: resolveNode uses node-cache
```

### Key Design Decisions

1. **Immutable-only caching** — Two types: ownership boolean existence (`own:*`) and CAS node decoded metadata (`node:meta:*`). Both are content-addressed and immutable. No cache invalidation needed, no consistency bugs possible.
2. **No negative caching** — Avoids the need to invalidate when new records/nodes are created. Trade-off: repeated misses hit DynamoDB/S3, acceptable for current load.
3. **Graceful degradation** — Every Redis call is wrapped in try-catch. If Redis is down, unavailable, or disabled, the system behaves identically to pre-cache behavior.
4. **No TTL** — Ownership records and CAS nodes are content-addressed. Once cached, they are valid forever. Redis memory is bounded by the number of unique records/nodes queried. (See GC considerations below.)
5. **`getOwnership` excluded** — Metadata fields (`uploadedBy`, `size`, `createdAt`) can be overwritten by concurrent `BatchWriteItem` calls. Only boolean existence is truly immutable.
6. **Batch `MGET` for chain lookups** — `hasOwnershipBatch` sends one `MGET` for all chain members, reducing N serial round-trips to 1.
7. **Node metadata size guard (8 KB)** — Large dict nodes with hundreds of children are not cached, bounding per-key memory. The S3 read for these is amortized by their rarity.

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
| E2E (`--preset e2e`) | Disabled | Validate system works without Redis (baseline correctness) |
| E2E + Redis (`--preset e2e:redis`) | `redis-test` on port 6380 | Validate caching doesn't break behavior; verify cache fills |

The `e2e:redis` preset uses the `redis-test` container (in-memory, no persistence) which starts clean each run. CI should run both `e2e` and `e2e:redis` to ensure correctness on both paths.

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
- **Scope set-node caching**: `scope-set-nodes` children fields are also immutable candidates for caching if read pressure increases.
- **ElastiCache Serverless migration**: Start with `cache.t4g.micro` for dev/staging, migrate to Serverless when traffic justifies the minimum baseline cost.
- **Redis memory monitoring**: CloudWatch alarms on `BytesUsedForCache` / `DatabaseMemoryUsagePercentage` to catch unbounded growth.
