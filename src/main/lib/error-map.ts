/**
 * Map low-level ssh2 / fs / network errors into user-facing messages.
 * Keeps technical detail in the underlying log entry while giving the
 * renderer something a user can act on.
 */
export function describeSshError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const msg = err.message;
  const code = (err as NodeJS.ErrnoException).code;

  if (code === 'ENOTFOUND' || /getaddrinfo|enotfound/i.test(msg)) {
    return 'Host not found — check the address.';
  }
  if (code === 'ECONNREFUSED' || /econnrefused/i.test(msg)) {
    return 'Connection refused — is SSH running on that port?';
  }
  if (code === 'ETIMEDOUT' || /timed out/i.test(msg)) {
    return 'Connection timed out — host or network may be unreachable.';
  }
  if (code === 'EHOSTUNREACH' || /ehostunreach/i.test(msg)) {
    return 'Host is unreachable from this network.';
  }
  if (/all configured authentication methods failed/i.test(msg)) {
    return 'Authentication failed — check username, password, or key.';
  }
  if (/handshake/i.test(msg) && /timeout|timed out/i.test(msg)) {
    return 'SSH handshake timed out — server may be slow or blocking the client.';
  }
  if (/host key/i.test(msg)) {
    return 'Host key verification failed.';
  }
  return msg;
}

/**
 * Classify a transfer error into a coarse category so the renderer can choose
 * an appropriate icon/colour and an actionable hint, without losing the raw
 * message.
 */
export type TransferErrorClass =
  | 'timeout'
  | 'permission'
  | 'disk-full'
  | 'connection'
  | 'cancelled'
  | 'unknown';

export function classifyTransferError(err: unknown): TransferErrorClass {
  if (!(err instanceof Error)) return 'unknown';
  const msg = err.message.toLowerCase();
  const code = (err as NodeJS.ErrnoException).code;
  if (msg.includes('cancel') || msg.includes('abort')) return 'cancelled';
  if (msg.includes('timeout') || msg.includes('timed out') || code === 'ETIMEDOUT')
    return 'timeout';
  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    msg.includes('permission denied') ||
    msg.includes('access denied')
  ) {
    return 'permission';
  }
  if (code === 'ENOSPC' || msg.includes('no space')) return 'disk-full';
  if (
    msg.includes('connection') ||
    msg.includes('channel') ||
    msg.includes('closed') ||
    code === 'ECONNRESET' ||
    code === 'EPIPE'
  ) {
    return 'connection';
  }
  return 'unknown';
}
