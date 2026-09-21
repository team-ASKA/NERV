/**
 * Redis connections for BullMQ.
 *
 * BullMQ needs `maxRetriesPerRequest: null` — it manages its own retries, and
 * ioredis's default of 20 makes blocking commands (BRPOPLPUSH, the core of the
 * consumer loop) throw during a failover instead of waiting it out.
 *
 * Connections are deliberately few: one shared by every Queue, one per Worker
 * (BullMQ requires a dedicated blocking connection per worker). At 10k users
 * the bottleneck is Redis connection count across replicas, not throughput.
 */

import IORedis, { type RedisOptions } from 'ioredis';
import { config, logger } from './config.js';

function options(): RedisOptions {
  const isTls = config.redisUrl.startsWith('rediss://');
  return {
    // Required by BullMQ for blocking commands.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Exponential-ish backoff, capped, so a Redis outage doesn't become a
    // reconnect storm from every pod at once.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    reconnectOnError: (err) => {
      // Upstash and most managed providers issue READONLY on failover; the
      // right response is to reconnect, not to surface the error.
      if (err.message.includes('READONLY')) return 2;
      return false;
    },
    ...(isTls ? { tls: { rejectUnauthorized: true } } : {}),
  };
}

const connections: IORedis[] = [];

/**
 * A new connection. BullMQ Workers must not share one — a blocked worker would
 * stall every other consumer on the same socket.
 */
export function createRedis(role: string): IORedis {
  if (!config.redisUrl) {
    throw new Error('REDIS_URL is not set; cannot create a Redis connection.');
  }
  const client = new IORedis(config.redisUrl, options());
  connections.push(client);

  client.on('error', (err) => logger.error({ role, err: err.message }, 'redis error'));
  client.on('reconnecting', () => logger.warn({ role }, 'redis reconnecting'));
  client.on('ready', () => logger.info({ role }, 'redis ready'));

  return client;
}

let shared: IORedis | null = null;

/** Shared connection for non-blocking use (Queue producers, QueueEvents). */
export function sharedRedis(): IORedis {
  if (!shared) shared = createRedis('shared');
  return shared;
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled(connections.map((c) => c.quit()));
  connections.length = 0;
  shared = null;
}

/** Liveness probe used by /readyz. */
export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await sharedRedis().ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
