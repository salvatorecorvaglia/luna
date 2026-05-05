import { app, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDatabase } from './database';
import log from '../lib/logger';

// The credentials table is created by migration 004_known_hosts_and_credentials.
// A fallback CREATE IF NOT EXISTS is kept for databases initialized before that migration.
let tableEnsured = false;

function ensureTable(): void {
  if (tableEnsured) return;
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      connection_id TEXT PRIMARY KEY,
      encrypted_data BLOB NOT NULL
    )
  `);
  tableEnsured = true;
}

let encryptionKey: Buffer | null = null;

/**
 * Load the per-user encryption key. When Electron's safeStorage is available
 * (macOS Keychain, Windows DPAPI, libsecret on Linux), the on-disk key file
 * is wrapped in OS-protected encryption. On platforms where safeStorage is
 * unavailable we fall back to the raw random key on disk. (S6)
 */
function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  const keyPath = join(app.getPath('userData'), '.storage_key');
  const wrappedPath = `${keyPath}.enc`;
  const canWrap = (() => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  })();

  if (canWrap && existsSync(wrappedPath)) {
    try {
      const decoded = safeStorage.decryptString(readFileSync(wrappedPath));
      // safeStorage.decryptString returns a string; convert to Buffer of raw bytes.
      encryptionKey = Buffer.from(decoded, 'latin1');
    } catch (err) {
      log.error('[Credentials] Failed to unwrap stored key — regenerating', err);
      encryptionKey = null;
    }
  }

  if (!encryptionKey) {
    if (existsSync(keyPath)) {
      encryptionKey = readFileSync(keyPath);
      // Migrate the plaintext key file into safeStorage when available.
      if (canWrap) {
        try {
          writeFileSync(wrappedPath, safeStorage.encryptString(encryptionKey.toString('latin1')));
          // Best-effort: leave the plaintext file in place to avoid breaking older
          // builds that still read keyPath. A future migration can delete it.
        } catch (err) {
          log.warn('[Credentials] Could not wrap existing key with safeStorage', err);
        }
      }
    } else {
      encryptionKey = randomBytes(32);
      if (canWrap) {
        try {
          writeFileSync(wrappedPath, safeStorage.encryptString(encryptionKey.toString('latin1')));
        } catch (err) {
          log.warn('[Credentials] safeStorage write failed, falling back to plaintext key', err);
          writeFileSync(keyPath, encryptionKey);
        }
      } else {
        writeFileSync(keyPath, encryptionKey);
      }
    }
  }
  return encryptionKey;
}

function appendTamperLog(message: string): void {
  try {
    const path = join(app.getPath('userData'), 'credential-tamper.log');
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Best-effort: if we can't even write the audit log, don't crash the caller.
  }
}

/**
 * AES-256-GCM Implementation
 * GCM provides Authenticated Encryption, ensuring both confidentiality and integrity.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encrypt(text: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

  const tag = cipher.getAuthTag();

  // Store as [IV (12 bytes)][Tag (16 bytes)][Encrypted Data]
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer): string {
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}

export function storeCredential(connectionId: string, secret: string): void {
  ensureTable();
  const db = getDatabase();
  const encrypted = encrypt(secret);

  db.prepare(
    'INSERT OR REPLACE INTO credentials (connection_id, encrypted_data) VALUES (?, ?)',
  ).run(connectionId, encrypted);
}

export function retrieveCredential(connectionId: string): string | null {
  ensureTable();
  const db = getDatabase();

  const row = db
    .prepare('SELECT encrypted_data FROM credentials WHERE connection_id = ?')
    .get(connectionId) as { encrypted_data: Buffer } | undefined;

  if (!row) return null;

  try {
    return decrypt(Buffer.from(row.encrypted_data));
  } catch (err) {
    // Decryption can fail if the data is corrupt, tampered with (GCM tag mismatch),
    // or if it was encrypted with a different key/algorithm (e.g. previous CBC).
    // Log loudly to a dedicated audit file so the operator can detect tampering
    // (S2). We still drop the row so the user is prompted to re-enter the
    // credential rather than seeing a permanently broken connection.
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      `[Credentials] Failed to decrypt credential for ${connectionId}; dropping entry: ${message}`,
    );
    appendTamperLog(`decrypt-failure connectionId=${connectionId} reason="${message}"`);
    try {
      db.prepare('DELETE FROM credentials WHERE connection_id = ?').run(connectionId);
    } catch (deleteErr) {
      log.warn('[Credentials] Failed to delete stale credential row:', deleteErr);
    }
    return null;
  }
}

export function deleteCredential(connectionId: string): void {
  ensureTable();
  const db = getDatabase();
  db.prepare('DELETE FROM credentials WHERE connection_id = ?').run(connectionId);
}

/**
 * Test-only: exposes the AES-GCM helpers so the round-trip and tamper-detection
 * paths can be exercised without a database. Production callers should always
 * go through store/retrieve so the SQLite layer stays authoritative.
 */
export const __test__ = { encrypt, decrypt };
