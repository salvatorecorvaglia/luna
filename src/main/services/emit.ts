import { BrowserWindow } from 'electron';
import { redact } from '../lib/redact';

/**
 * Channels that stream raw shell output. Redaction would corrupt the bytestream
 * (passwords are commonly typed at prompts and the renderer needs the exact
 * characters back). Everything else — status, errors, dialogs — is structured
 * metadata where redaction is safe and required (S7).
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
