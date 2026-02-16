/**
 * Redis client singleton — graceful degradation.
 *
 * If Redis is disabled or connection fails, returns `null`.
 * All cache callers check for `null` and fall through to the backing store.
 */

import Redis from "ioredis";
import type { RedisConfig } from "../config.ts";

/**
 * Create an ioredis client tuned for Lambda / server workloads.
 * Returns `null` when Redis is disabled or connection init fails.
 */
export const createRedisClient = (config: RedisConfig): Redis | null => {
  if (!config.enabled) return null;

  try {
    const client = new Redis(config.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: config.connectTimeoutMs,
      commandTimeout: config.commandTimeoutMs,
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 200, 1000);
      },
    });

    // Suppress unhandled error events (graceful degradation)
    client.on("error", () => {});

    return client;
  } catch {
    return null;
  }
};
