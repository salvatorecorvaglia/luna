import { createHash } from 'crypto';
import { getDatabase } from './database';

/**
 * Build the composite key used as the known_hosts primary key. IPv6 addresses
 * contain `:` characters, so a naive `${host}:${port}` format is ambiguous —
 * `::1:22` could be host `::1` port `22` or host `::` port `1:22`. We wrap any
 * host that contains a `:` (and isn't already bracketed) in `[...]` so the
 * separator before `port` is always unambiguous.
 */
export function formatHostKey(host: string, port: number): string {
  const needsBrackets = host.includes(':') && !host.startsWith('[');
  return needsBrackets ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Allowlist of acceptable host-key algorithms. Reject weak or deprecated
 * algorithms (ssh-dss, plain ssh-rsa with SHA-1, anything else unknown) so
 * a downgrade-attack can't trick TOFU into trusting a weaker key.
 */
const ALLOWED_HOST_KEY_ALGORITHMS = new Set([
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-256',
  'rsa-sha2-512',
]);

export function isAllowedHostKeyAlgorithm(algorithm: string): boolean {
  return ALLOWED_HOST_KEY_ALGORITHMS.has(algorithm);
}

export function fingerprintKey(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64');
}

export function getStoredHostKey(
  host: string,
  port: number,
): { fingerprint: string; algorithm: string } | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')
    .get(formatHostKey(host, port)) as { fingerprint: string; algorithm: string } | undefined;
  return row ?? null;
}

/**
 * Trust-on-first-use (TOFU) host key verification.
 * Stores host key fingerprints keyed by "host:port".
 * On first connection, the key is accepted and stored.
 * On subsequent connections, the key must match.
 */

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
  algorithm: string,
): { trusted: boolean; changed: boolean; isFirst: boolean; weakAlgorithm?: boolean } {
  // Reject deprecated/weak algorithms outright so neither first-use nor a
  // matching stored fingerprint can wave them through.
  if (!isAllowedHostKeyAlgorithm(algorithm)) {
    return { trusted: false, changed: false, isFirst: false, weakAlgorithm: true };
  }

  const db = getDatabase();
  const hostKey = formatHostKey(host, port);
  const fp = fingerprintKey(keyData);

  const row = db
    .prepare('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')
    .get(hostKey) as { fingerprint: string; algorithm: string } | undefined;

  if (!row) {
    return { trusted: false, changed: false, isFirst: true };
  }

  if (row.fingerprint === fp) {
    return { trusted: true, changed: false, isFirst: false };
  }

  // Key has changed — possible MITM
  return { trusted: false, changed: true, isFirst: false };
}

/**
 * Update the stored host key (user chose to trust the new key).
 *
 * Re-validates the algorithm allowlist before persisting. `verifyHostKey`
 * already rejects weak algorithms during the connection handshake, but the
 * trust path is reachable from a user-action (Trust button on the prompt)
 * and a future regression that surfaces a weak-algo key to that prompt
 * would otherwise persist it permanently. Refusing weak algorithms here
 * is a hard policy that doesn't depend on prompt-side validation.
 */
export function updateHostKey(
  host: string,
  port: number,
  keyData: Buffer,
  algorithm: string,
): void {
  if (!isAllowedHostKeyAlgorithm(algorithm)) {
    throw new Error(
      `Refusing to store host key with disallowed algorithm "${algorithm}". ` +
        `The server must advertise ed25519, ecdsa-sha2-*, or rsa-sha2-* host keys.`,
    );
  }

  const db = getDatabase();
  const hostKey = formatHostKey(host, port);
  const fp = fingerprintKey(keyData);

  db.prepare(
    `INSERT INTO known_hosts (host_key, algorithm, fingerprint, first_seen)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(host_key) DO UPDATE SET algorithm = excluded.algorithm, fingerprint = excluded.fingerprint`,
  ).run(hostKey, algorithm, fp);
}
