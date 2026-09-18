import {
  fingerprintKey,
  formatHostKey,
  isAllowedHostKeyAlgorithm,
  updateHostKey,
} from '../host-key-store';

/**
 * Extract the SSH host-key algorithm from the wire-format key buffer.
 * SSH host keys are encoded as: uint32 length || algorithm-name-string || ...
 * Returns 'unknown' if the buffer is malformed.
 */
export function parseHostKeyAlgorithm(key: Buffer): string {
  if (key.length < 4) return 'unknown';
  const len = key.readUInt32BE(0);
  if (len === 0 || len > 64 || key.length < 4 + len) return 'unknown';
  return key.subarray(4, 4 + len).toString('ascii');
}

interface PendingHostKey {
  key: Buffer;
  algorithm: string;
  createdAt: number;
}

/**
 * LRU-bounded and TTL-expired registry of host keys that failed verification and are awaiting
 * an explicit user trust action. Capped to prevent unbounded growth on
 * repeated mismatches against the same set of hosts.
 */
export class PendingHostKeyRegistry {
  private static readonly MAX = 64;
  private static readonly TTL_MS = 15 * 60 * 1000; // 15 minutes
  private map = new Map<string, PendingHostKey>();

  private evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.map.entries()) {
      if (now - v.createdAt > PendingHostKeyRegistry.TTL_MS) {
        this.map.delete(k);
      }
    }
  }

  /**
   * Record a host key awaiting user trust. Returns `false` if the algorithm
   * is not on the allowlist — the candidate is dropped without being stored,
   * so a later `trust()` call can't be coerced into committing a weak key by
   * exploiting a refactor that bypassed `trust()`'s own algorithm check.
   */
  remember(host: string, port: number, key: Buffer, algorithm: string): boolean {
    if (!isAllowedHostKeyAlgorithm(algorithm)) return false;
    this.evictExpired();
    const k = formatHostKey(host, port);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { key: Buffer.from(key), algorithm, createdAt: Date.now() });
    while (this.map.size > PendingHostKeyRegistry.MAX) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return true;
  }

  /**
   * Trust a captured host key so the next connect succeeds. Returns the
   * fingerprint that was stored, or null if no candidate is pending OR if
   * the captured algorithm is no longer on the allowlist. Re-checking the
   * algorithm here is defense-in-depth: even if a future refactor lets a
   * weak-algo key reach `remember()`, `trust()` will refuse to commit it.
   */
  trust(host: string, port: number): string | null {
    this.evictExpired();
    const k = formatHostKey(host, port);
    const pending = this.map.get(k);
    if (!pending) return null;
    if (Date.now() - pending.createdAt > PendingHostKeyRegistry.TTL_MS) {
      this.map.delete(k);
      return null;
    }
    if (!isAllowedHostKeyAlgorithm(pending.algorithm)) {
      this.map.delete(k);
      return null;
    }
    updateHostKey(host, port, pending.key, pending.algorithm);
    this.map.delete(k);
    return fingerprintKey(pending.key);
  }

  forget(host: string, port: number): void {
    this.map.delete(formatHostKey(host, port));
  }
}
