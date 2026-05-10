import { TimeoutError } from '../../lib/with-timeout';
import { SshConnectionError } from '../../lib/errors';

/** Node/ssh2 error codes that imply the SFTP channel/socket is gone. */
const FATAL_ERR_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ENOTCONN',
  'ECONNABORTED',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_PREMATURE_CLOSE',
]);

/**
 * Detect errors that indicate the underlying SFTP session is unusable and
 * must be re-opened. The caller decides whether to retry; this is just the
 * classifier.
 */
export function isSessionFatal(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof SshConnectionError) return true;
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code && FATAL_ERR_CODES.has(code)) return true;
  // Fallback: ssh2 doesn't always populate codes for channel teardown.
  const msg = err.message.toLowerCase();
  return (
    msg.includes('channel') ||
    msg.includes('connection') ||
    msg.includes('closed') ||
    msg.includes('not connected')
  );
}

/**
 * Render a POSIX 9-bit permission mode as the familiar `rwxr-xr-x` string.
 * Only the lowest 9 bits are inspected; setuid/setgid/sticky are ignored.
 */
export function formatPermissions(mode: number): string {
  const chars = 'rwxrwxrwx';
  let result = '';
  for (let i = 0; i < 9; i++) {
    result += mode & (1 << (8 - i)) ? chars[i] : '-';
  }
  return result;
}
