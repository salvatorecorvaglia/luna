import { safeStorage } from 'electron'
import { getDatabase } from './database'
import log from '../lib/logger'

// The credentials table is created by migration 004_known_hosts_and_credentials.
// A fallback CREATE IF NOT EXISTS is kept for databases initialized before that migration.
let tableEnsured = false

function ensureTable(): void {
  if (tableEnsured) return
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      connection_id TEXT PRIMARY KEY,
      encrypted_data BLOB NOT NULL
    )
  `)
  tableEnsured = true
}

export function storeCredential(connectionId: string, secret: string): void {
  ensureTable()
  const db = getDatabase()

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }

  const encrypted = safeStorage.encryptString(secret)

  db.prepare(
    'INSERT OR REPLACE INTO credentials (connection_id, encrypted_data) VALUES (?, ?)'
  ).run(connectionId, encrypted)
}

export function retrieveCredential(connectionId: string): string | null {
  ensureTable()
  const db = getDatabase()

  const row = db
    .prepare('SELECT encrypted_data FROM credentials WHERE connection_id = ?')
    .get(connectionId) as { encrypted_data: Buffer } | undefined

  if (!row) return null

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }

  try {
    return safeStorage.decryptString(Buffer.from(row.encrypted_data))
  } catch (err) {
    // The OS keychain entry that wrapped this blob is gone (reinstall, OS
    // upgrade, profile move). Drop the unusable row so the user is prompted
    // to re-enter the secret on the next attempt instead of hitting this on
    // every reconnect.
    log.warn(
      `[Credentials] Failed to decrypt credential for ${connectionId}; deleting stale entry: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    try {
      db.prepare('DELETE FROM credentials WHERE connection_id = ?').run(connectionId)
    } catch (deleteErr) {
      log.warn('[Credentials] Failed to delete stale credential row:', deleteErr)
    }
    return null
  }
}

export function deleteCredential(connectionId: string): void {
  ensureTable()
  const db = getDatabase()
  db.prepare('DELETE FROM credentials WHERE connection_id = ?').run(connectionId)
}
