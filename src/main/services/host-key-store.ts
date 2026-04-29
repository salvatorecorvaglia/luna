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
 * Verify a host key. Returns true if the key is trusted.
 * On first encounter the key is stored automatically (TOFU).
 * Returns false if the key has changed (possible MITM).
 */
export function verifyHostKey(
  host: string,
  port: number,
  keyData: Buffer,
  algorithm: string
): { trusted: boolean; changed: boolean } {
  const db = getDatabase()
  const hostKey = `${host}:${port}`
  const fp = fingerprint(keyData)

  const row = db
    .prepare('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')
    .get(hostKey) as { fingerprint: string; algorithm: string } | undefined

  if (!row) {
    // First connection — trust on first use
    db.prepare('INSERT INTO known_hosts (host_key, algorithm, fingerprint) VALUES (?, ?, ?)').run(
      hostKey,
      algorithm,
      fp
    )
    return { trusted: true, changed: false }
  }

  if (row.fingerprint === fp) {
    return { trusted: true, changed: false }
  }

  // Key has changed — possible MITM
  return { trusted: false, changed: true }
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
    'INSERT OR REPLACE INTO known_hosts (host_key, algorithm, fingerprint, first_seen) VALUES (?, ?, ?, unixepoch())'
  ).run(hostKey, algorithm, fp)
}
