import { IPC } from '@shared/constants';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';
import { SlidingWindowLimiter } from '../lib/sliding-window-limiter';

// Unlike every other high-frequency/user-influenced channel (credentials,
// SSH/S3 connect, presign), this one had no rate limit beyond the global 4
// MiB per-call payload ceiling — a chatty or compromised renderer could burn
// disk before the 10 MB log-rotation cap kicked in. The window is generous
// since normal debug/info logging can legitimately burst.
const logMessageLimiter = new SlidingWindowLimiter(300, 10_000, 'Renderer log');

/** Longest renderer message written to the log, in characters. */
const MAX_MESSAGE_CHARS = 8192;

/**
 * Make a renderer-supplied message safe to write as one log line.
 *
 * Raw CR/LF let the renderer forge whole log entries — a message ending in
 * "\n[12:00:00.000] [info] [Main] ..." reads as a genuine main-process line to
 * anyone auditing the file. Control characters are escaped rather than
 * dropped so the original text stays recoverable.
 */
export function sanitizeLogMessage(message: unknown): string {
  const text = typeof message === 'string' ? message : String(message);
  const clipped =
    text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…[truncated]` : text;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  return clipped.replace(/[\u0000-\u001f\u007f]/g, (c) => {
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

export function registerLogHandlers(): void {
  registerHandler(
    IPC.LOG_MESSAGE,
    (
      _event,
      {
        level,
        message,
        context,
      }: {
        level: 'info' | 'warn' | 'error' | 'debug';
        message: string;
        context?: Record<string, unknown>;
      },
    ) => {
      logMessageLimiter.check();
      message = sanitizeLogMessage(message);
      const data: unknown[] = [`[Renderer] ${message}`];
      if (context) data.push(context);

      switch (level) {
        case 'info':
          log.info(...data);
          break;
        case 'warn':
          log.warn(...data);
          break;
        case 'error':
          data[0] = `[Renderer Error] ${message}`;
          log.warn(...data);
          break;
        case 'debug':
          log.debug(...data);
          break;
        default:
          log.info(...data);
          break;
      }
    },
  );
}
