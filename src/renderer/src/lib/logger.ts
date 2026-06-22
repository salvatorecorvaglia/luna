/**
 * Renderer-side logger that forwards messages to the main process logger.
 * This ensures all logs (Main and Renderer) end up in the same log file.
 */
function forward(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context?: Record<string, unknown>,
): void {
  // The IPC call can reject if the bridge tears down mid-call (page reload,
  // window close). We never want a log line to surface as an unhandled
  // rejection — it would mask the original error the caller was trying to
  // log. Swallow into the renderer console so the message is still visible.
  window.api.log(level, message, context).catch((err: unknown) => {
    console.error('[logger] forward to main failed', err);
  });
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    console.info(`[info] ${message}`, context || '');
    forward('info', message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    console.warn(`[warn] ${message}`, context || '');
    forward('warn', message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    console.error(`[error] ${message}`, context || '');
    forward('error', message, context);
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    console.debug(`[debug] ${message}`, context || '');
    forward('debug', message, context);
  },
};
