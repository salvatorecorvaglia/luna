import { app, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDatabase } from './database';
import log from '../lib/logger';

// The credentials table is created by migration 004_known_hosts_and_credentials.
// A fallback CREATE IF NOT EXISTS is kept for databases initialized before that
// migration. We don't cache the result by a simple boolean: a future code path
// (tests, multi-profile) could swap the SQLite handle, and a stale cache would
// skip the create and crash. The CREATE statement is cheap to re-run.
function ensureTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      connection_id TEXT PRIMARY KEY,
      encrypted_data BLOB NOT NULL
    )
  `);
}

let encryptionKey: Buffer | null = null;
/**
 * Tracks whether the credential store is currently using a plaintext on-disk
 * key (Linux without libsecret, with a pre-existing key file). The renderer
 * reads this via getCredentialBackendStatus() to surface a security banner.
 */
let usingPlaintextKey = false;

/**
 * Load the per-user encryption key. When Electron's safeStorage is available
 * (macOS Keychain, Windows DPAPI, libsecret on Linux), the on-disk key file
 * is wrapped in OS-protected encryption. On platforms where safeStorage is
 * unavailable we fall back to the raw random key on disk.
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
      // safeStorage.decryptString returns a string. The wrapper round-trips
      // 32 random bytes as base64 — UTF-8 safe, and immune to any future
      // Electron tightening that rejects non-UTF-8 input. A latin1-encoded
      // legacy file would not start with valid base64 chars; fall back to
      // latin1 in that case so existing installs keep working.
      const fromBase64 = Buffer.from(decoded, 'base64');
      encryptionKey = fromBase64.length === 32 ? fromBase64 : Buffer.from(decoded, 'latin1');
    } catch (err) {
      log.error('[Credentials] Failed to unwrap stored key — regenerating', err);
      encryptionKey = null;
    }
  }

  if (!encryptionKey) {
    if (existsSync(keyPath)) {
      // Existing install with a plaintext key file: keep reading it so we don't
      // strand stored credentials, but migrate into safeStorage if available
      // and warn loudly otherwise so the operator knows to fix their keyring.
      // Operators can opt out of plaintext-key fallback entirely by setting
      // LUNAR_REQUIRE_OS_KEYRING=1 — credentials become unreadable until
      // libsecret is installed, which is the safer default for shared hosts.
      if (!canWrap && process.env.LUNAR_REQUIRE_OS_KEYRING === '1') {
        throw new Error(
          'LUNAR_REQUIRE_OS_KEYRING=1 is set and OS-level secret storage is unavailable. ' +
            'Install gnome-keyring or libsecret-1-0 and restart, or unset the variable to ' +
            'allow the existing plaintext key file.',
        );
      }
      encryptionKey = readFileSync(keyPath);
      if (canWrap) {
        try {
          writeFileSync(wrappedPath, safeStorage.encryptString(encryptionKey.toString('base64')));
        } catch (err) {
          log.warn('[Credentials] Could not wrap existing key with safeStorage', err);
        }
      } else {
        usingPlaintextKey = true;
        log.warn(
          '[Credentials] Using plaintext key file because safeStorage is unavailable. ' +
            'Install gnome-keyring or libsecret-1-0 and restart to migrate to OS-protected storage.',
        );
      }
    } else if (canWrap) {
      encryptionKey = randomBytes(32);
      try {
        writeFileSync(wrappedPath, safeStorage.encryptString(encryptionKey.toString('base64')));
      } catch (err) {
        // safeStorage said it was available but encryption still failed. Don't
        // silently fall back to plaintext on disk: credentials would be
        // recoverable by anyone with read access to the user's data dir.
        encryptionKey = null;
        throw new Error(
          `Failed to write OS-protected encryption key: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    } else {
      // Fresh install on a platform without safeStorage (e.g. Linux without
      // libsecret). Refuse to persist a plaintext master key — credential
      // storage is opt-in and the user must install a keyring backend first.
      throw new Error(
        'Cannot initialize credential storage: OS-level secret storage (safeStorage) is ' +
          'unavailable. On Linux, install gnome-keyring or libsecret-1-0 and restart.',
      );
    }
  }
  return encryptionKey;
}

/**
 * Dedup window for tamper-log entries. Repeated decrypt failures for the
 * same connection (e.g. UI retrying retrieval in a loop) would otherwise
 * append identical lines forever.
 */
const TAMPER_LOG_DEDUP_MS = 60_000;
const TAMPER_LOG_DEDUP_MAX = 1_024;
const tamperLogSeen = new Map<string, number>();

export interface CredentialTamperEvent {
  connectionId: string;
  reason: string;
  at: number;
}

type TamperListener = (event: CredentialTamperEvent) => void;
const tamperListeners = new Set<TamperListener>();

/**
 * Subscribe to credential-tamper events. The main process wires this to a
 * webContents.send() so the renderer can show a security banner.
 */
export function onCredentialTamper(listener: TamperListener): () => void {
  tamperListeners.add(listener);
  return () => tamperListeners.delete(listener);
}

function emitTamper(event: CredentialTamperEvent): void {
  for (const listener of tamperListeners) {
    try {
      listener(event);
    } catch (err) {
      log.warn('[Credentials] tamper listener threw', err);
    }
  }
}

function appendTamperLog(message: string): void {
  const now = Date.now();
  const last = tamperLogSeen.get(message);
  if (last !== undefined && now - last < TAMPER_LOG_DEDUP_MS) return;
  tamperLogSeen.set(message, now);
  // Opportunistic GC of the dedup map so it doesn't grow unbounded across
  // long sessions with many distinct failures.
  if (tamperLogSeen.size > 256) {
    for (const [key, ts] of tamperLogSeen) {
      if (now - ts >= TAMPER_LOG_DEDUP_MS) tamperLogSeen.delete(key);
    }
  }
  // Hard cap: even if every message is fresh (e.g. attacker-controlled
  // distinct failure messages), the map cannot grow without bound. Drop the
  // oldest insertion-order entries to keep memory predictable.
  while (tamperLogSeen.size > TAMPER_LOG_DEDUP_MAX) {
    const oldest = tamperLogSeen.keys().next();
    if (oldest.done) break;
    tamperLogSeen.delete(oldest.value);
  }
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
  // Defensive length check: a truncated blob would otherwise hand
  // createDecipheriv a short IV (silently — IV length is asserted by the
  // backing OpenSSL call only on some platforms) or hand setAuthTag a tag
  // that's not exactly 16 bytes. Failing fast here yields a clear error in
  // the tamper log instead of an opaque "Unsupported state" from OpenSSL.
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error(
      `ciphertext too short: ${data.length} bytes (need ≥ ${IV_LENGTH + TAG_LENGTH})`,
    );
  }
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
    // Log loudly to a dedicated audit file so the operator can detect tampering.
    // We still drop the row so the user is prompted to re-enter the
    // credential rather than seeing a permanently broken connection.
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      `[Credentials] Failed to decrypt credential for ${connectionId}; dropping entry: ${message}`,
    );
    appendTamperLog(`decrypt-failure connectionId=${connectionId} reason="${message}"`);
    emitTamper({ connectionId, reason: message, at: Date.now() });
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

/** Shape of an S3 credential blob serialised through `storeCredential`. */
export interface S3CredentialBlob {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Retrieve an S3 credential. Returns null if no credential is stored or the
 * blob isn't valid JSON / is missing required fields. Consumers should treat
 * a null return as "credential missing or corrupt — re-enter".
 */
export function retrieveS3Credential(connectionId: string): S3CredentialBlob | null {
  const raw = retrieveCredential(connectionId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<S3CredentialBlob>;
    if (
      typeof parsed.accessKeyId !== 'string' ||
      typeof parsed.secretAccessKey !== 'string' ||
      !parsed.accessKeyId ||
      !parsed.secretAccessKey
    ) {
      return null;
    }
    const out: S3CredentialBlob = {
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey,
    };
    if (typeof parsed.sessionToken === 'string' && parsed.sessionToken) {
      out.sessionToken = parsed.sessionToken;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Reports the credential-store backend in use. The renderer surfaces a
 * security banner when `backend === 'plaintext'` so operators know their
 * stored credentials are not OS-protected.
 */
export function getCredentialBackendStatus(): {
  backend: 'safeStorage' | 'plaintext' | 'uninitialized';
} {
  if (!encryptionKey) return { backend: 'uninitialized' };
  return { backend: usingPlaintextKey ? 'plaintext' : 'safeStorage' };
}

/**
 * Force-initializes the encryption key. Should be called at startup so the
 * renderer correctly identifies the backend (especially plaintext fallbacks
 * on Linux) before the first credential access.
 */
export function initializeCredentialStore(): void {
  try {
    getEncryptionKey();
  } catch (err) {
    // Initialization failure (e.g. fresh install on Linux without libsecret)
    // is logged but not re-thrown here; the specific error will propagate
    // when a store/retrieve operation is actually attempted.
    log.warn('[Credentials] Eager initialization failed:', err);
  }
}

/**
 * Test-only: exposes the AES-GCM helpers so the round-trip and tamper-detection
 * paths can be exercised without a database. Production callers should always
 * go through store/retrieve so the SQLite layer stays authoritative.
 */
export const __test__ = { encrypt, decrypt };
