import { createHash } from 'crypto'
import { getDatabase } from './database'

export function fingerprintKey(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64')
}

export function getStoredHostKey(
  host: string,
  port: number
): { fingerprint: string; algorithm: string } | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')
    .get(`${host}:${port}`) as { fingerprint: string; algorithm: string } | undefined
  return row ?? null
}

/**
 * Trust-on-first-use (TOFU) host key verification.
 * Stores host key fingerprints keyed by "host:port".
 * On first connection, the key is accepted and stored.
 * On subsequent connections, the key must match.
 */

function fingerprint(key: Buffer): string {
  return fingerprintKey(key)
}

/**
 * Verify a host key.
 * Returns `trusted: false, isFirst: true` for never-seen-before hosts so the caller
 * can prompt the user for explicit trust (instead of silently auto-storing).
 * Returns `trusted: false, changed: true` if the stored fingerprint differs.
 */
export function verifyHostKey(
  host: string,
  port: number,
  keyData: Buffer,
  _algorithm: string
): { trusted: boolean; changed: boolean; isFirst: boolean } {
  const db = getDatabase()
  const hostKey = `${host}:${port}`
  const fp = fingerprint(keyData)

  const row = db
    .prepare('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')
    .get(hostKey) as { fingerprint: string; algorithm: string } | undefined

  if (!row) {
    return { trusted: false, changed: false, isFirst: true }
  }

  if (row.fingerprint === fp) {
    return { trusted: true, changed: false, isFirst: false }
  }

  // Key has changed — possible MITM
  return { trusted: false, changed: true, isFirst: false }
}

/**
 * Update the stored host key (user chose to trust the new key).
 */
export function updateHostKey(
  host: string,
  port: number,
  keyData: Buffer,
  algorithm: string
): void {
  const db = getDatabase()
  const hostKey = `${host}:${port}`
  const fp = fingerprint(keyData)

  db.prepare(
    `INSERT INTO known_hosts (host_key, algorithm, fingerprint, first_seen)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(host_key) DO UPDATE SET algorithm = excluded.algorithm, fingerprint = excluded.fingerprint`
  ).run(hostKey, algorithm, fp)
}
