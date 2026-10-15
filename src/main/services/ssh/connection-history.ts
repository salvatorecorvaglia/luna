import { randomUUID } from 'node:crypto';
import log from '../../lib/logger';
import { getDatabase } from '../database';

/**
 * `connection_history` bookkeeping, extracted from SshManager so the session
 * lifecycle there no longer mixes in SQL for an audit table.
 *
 * Every write is best-effort: history is a record of what happened, and a
 * failed insert or update must never affect a live connection.
 */

/**
 * How often to prune `connection_history`. The prune used to run on every
 * successful connect, executing a correlated `NOT IN (SELECT … ORDER BY …
 * LIMIT 1000)` subquery each time — a full scan + sort on the hot connect
 * path for a table that only needs trimming occasionally.
 */
const HISTORY_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Retained `connection_history` rows. */
const HISTORY_RETENTION_ROWS = 1000;

let lastPruneAt = 0;

/**
 * Record a successful connect: bump `last_connected_at` and open a history
 * row. Returns the row id to close later, or undefined if the write failed.
 */
export function recordConnect(connectionId: string): string | undefined {
  try {
    const db = getDatabase();
    db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000),
      connectionId,
    );
    const historyId = randomUUID();
    db.prepare('INSERT INTO connection_history (id, connection_id) VALUES (?, ?)').run(
      historyId,
      connectionId,
    );
    pruneIfDue();
    return historyId;
  } catch (err) {
    log.warn(`[SSH] Failed to record connection info for ${connectionId}:`, err);
    return undefined;
  }
}

/** Close out a history row opened by recordConnect(). */
export function recordDisconnect(historyId: string): void {
  try {
    const now = Math.floor(Date.now() / 1000);
    getDatabase()
      .prepare(
        'UPDATE connection_history SET disconnected_at = ?, duration_secs = (? - connected_at) WHERE id = ?',
      )
      .run(now, now, historyId);
  } catch (err) {
    log.warn(`[SSH] Failed to record disconnect history for ${historyId}:`, err);
  }
}

/**
 * Trim `connection_history` at most once an hour rather than on every
 * connect. The delete is a full scan + sort of the table; running it inline
 * with each handshake put that cost on the interactive connect path for no
 * benefit — a few hundred extra rows between prunes are harmless.
 */
function pruneIfDue(): void {
  const now = Date.now();
  if (now - lastPruneAt < HISTORY_PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  getDatabase()
    .prepare(
      `DELETE FROM connection_history
       WHERE id NOT IN (
         SELECT id FROM connection_history ORDER BY connected_at DESC LIMIT ?
       )`,
    )
    .run(HISTORY_RETENTION_ROWS);
}
