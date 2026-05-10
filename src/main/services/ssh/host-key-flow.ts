import { fingerprintKey, formatHostKey, updateHostKey } from '../host-key-store';

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
}

/**
 * LRU-bounded registry of host keys that failed verification and are awaiting
 * an explicit user trust action. Capped to prevent unbounded growth on
 * repeated mismatches against the same set of hosts.
 */
export class PendingHostKeyRegistry {
  private static readonly MAX = 64;
  private map = new Map<string, PendingHostKey>();

  remember(host: string, port: number, key: Buffer, algorithm: string): void {
    const k = formatHostKey(host, port);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { key: Buffer.from(key), algorithm });
    while (this.map.size > PendingHostKeyRegistry.MAX) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /**
   * Trust a captured host key so the next connect succeeds. Returns the
   * fingerprint that was stored, or null if no candidate is pending.
   */
  trust(host: string, port: number): string | null {
    const k = formatHostKey(host, port);
    const pending = this.map.get(k);
    if (!pending) return null;
    updateHostKey(host, port, pending.key, pending.algorithm);
    this.map.delete(k);
    return fingerprintKey(pending.key);
  }

  forget(host: string, port: number): void {
    this.map.delete(formatHostKey(host, port));
  }
}
