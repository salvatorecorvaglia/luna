/* eslint-disable no-console */
/**
 * Renderer-side logger that forwards messages to the main process logger.
 * This ensures all logs (Main and Renderer) end up in the same log file.
 */
export const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    console.info(`[info] ${message}`, context || '');
    void window.api.log('info', message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    console.warn(`[warn] ${message}`, context || '');
    void window.api.log('warn', message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    console.error(`[error] ${message}`, context || '');
    void window.api.log('error', message, context);
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    console.debug(`[debug] ${message}`, context || '');
    void window.api.log('debug', message, context);
  },
};
