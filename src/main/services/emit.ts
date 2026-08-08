import { BrowserWindow } from 'electron';
import { redact } from '../lib/redact';

/**
 * Channels that stream raw shell output. Redaction would corrupt the bytestream
 * (passwords are commonly typed at prompts and the renderer needs the exact
 * characters back). Everything else — status, errors, dialogs — is structured
 * metadata where redaction is safe and required.
 *
 * Note that `local-terminal:on-data` is an equally raw bytestream but is
 * deliberately *not* listed here, because it never reaches this module:
 * `local-terminal.ipc.ts` calls `webContents.send` directly, since it already
 * coalesces frames on a 16 ms timer and re-walking every frame through
 * `redact()` would put a full object traversal on that hot path. Leaving it
 * off the allowlist keeps the safe default — if that send is ever routed
 * through `emitToRenderer`, it gets redacted rather than silently bypassing
 * it. `__tests__/emit.test.ts` pins that behaviour.
 */
const RAW_CHANNELS = new Set<string>(['ssh:on-data']);

/** Broadcast a message to all renderer windows. */
export function emitToRenderer(channel: string, data: unknown): void {
  const payload = RAW_CHANNELS.has(channel) ? data : redact(data);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
