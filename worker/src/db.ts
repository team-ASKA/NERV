/**
 * Postgres access for the worker.
 *
 * Pooling note for scale: point DATABASE_URL at Supabase's *transaction*
 * pooler (port 6543), not the direct connection (5432). Direct connections are
 * capped low and a handful of replicas will exhaust them. The transaction
 * pooler does not support session-scoped state, which is exactly why every
 * lock in the schema is `pg_advisory_xact_lock` (transaction-scoped) rather
 * than `pg_advisory_lock` (session-scoped) — the latter would leak under
 * pgBouncer.
 */

import pg from 'pg';
import { config, logger } from './config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (pool) return pool;
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set; cannot connect to Postgres.');
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // A runaway query must never pin a pooled connection forever.
    statement_timeout: 30_000,
    query_timeout: 30_000,
    ...(config.databaseUrl.includes('localhost') ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  // An idle-client error would otherwise be an unhandled 'error' event and
  // take the process down.
  pool.on('error', (err) => logger.error({ err: err.message }, 'idle postgres client error'));

  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db().query<T>(text, params);
  return result.rows;
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * All advisory locks must be taken inside one of these: they are released at
 * COMMIT or ROLLBACK, so a crash mid-transaction frees them automatically.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: (rollbackErr as Error).message }, 'rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    await query('select 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
