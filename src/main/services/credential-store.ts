import { app } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
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

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  const keyPath = join(app.getPath('userData'), '.storage_key');

  if (existsSync(keyPath)) {
    encryptionKey = readFileSync(keyPath);
  } else {
    encryptionKey = randomBytes(32);
    writeFileSync(keyPath, encryptionKey);
  }
  return encryptionKey;
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
    // or if it was encrypted with a different key/algorithm (e.g. previous CBC/safeStorage).
    log.warn(
      `[Credentials] Failed to decrypt credential for ${connectionId}; deleting stale entry: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
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
